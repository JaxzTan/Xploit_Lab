"""v1 API: engine fixture table (TRD_V2 §4.2), lint, validator verdicts and the SSE stream."""

import asyncio
import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.v1 import ai, checks, engine
from app.v1.schema import lint

client = TestClient(app)
SAMPLE = json.loads(ai.SAMPLE_PATH.read_text())


def parsed(raw=SAMPLE):
    res = lint(copy.deepcopy(raw))
    assert res.ok, res.as_dict()
    return res.data, res.entry


def golden_analysis():
    return ai.AttackAnalysis.model_validate(ai.golden_for(parsed()[0])["analysis"])


# ---------------------------------------------------------------- engine (§4.2 table)

def test_engine_current():
    d, entry = parsed()
    v = engine.compute(d, entry)
    assert v["financial_exposure_usd"] == 2_300_000
    assert [(p["node_id"], p["exposure"]) for p in v["per_system"]] == [
        ("payments-core", 1_500_000), ("refunds-api", 800_000)]
    assert (v["disruption_hours"], v["cyber_risk"], v["regulatory_status"], v["complete"]) == (
        72, "HIGH", "MATERIAL", True)


@pytest.mark.parametrize("cid,total,dis,cyber,reg,complete,avoided,per_hour", [
    ("revoke-payment-write", 800_000, 24, "MEDIUM", "BELOW", True, 1_500_000, 1_500_000),
    ("revoke-refund-write", 1_500_000, 72, "HIGH", "MATERIAL", True, 800_000, 133_333),
    ("rotate-vendor-key", 0, 0, "LOW", "BELOW", True, 2_300_000, 766_667),
    ("clear-evidence", 3_100_000, 72, "HIGH", "MATERIAL", False, -800_000, None),
])
def test_engine_what_ifs(cid, total, dis, cyber, reg, complete, avoided, per_hour):
    d, entry = parsed()
    w = {w["id"]: w for w in engine.what_ifs(d, entry, engine.compute(d, entry))}[cid]
    a = w["after"]
    assert (a["financial_exposure_usd"], a["disruption_hours"], a["cyber_risk"],
            a["regulatory_status"], a["complete"]) == (total, dis, cyber, reg, complete)
    assert w["avoided_usd"] == avoided
    assert (None if w["per_hour_usd"] is None else engine.js_round(w["per_hour_usd"])) == per_hour


def test_engine_does_not_mutate_input():
    d, entry = parsed()
    before = d.model_dump()
    engine.what_ifs(d, entry, engine.compute(d, entry))
    assert d.model_dump() == before


def test_engine_unknown_bypass_and_empty_reach():
    raw = copy.deepcopy(SAMPLE)
    del raw["edges"][1]["control_bypass_probability"]  # e2
    d, entry = parsed(raw)
    v = engine.compute(d, entry)
    assert not v["complete"]
    assert v["per_system"][0]["bypass_unknown"] and v["per_system"][0]["exposure"] == 1_875_000
    raw["entry"] = "audit-log"
    d, entry = parsed(raw)
    v = engine.compute(d, entry)
    assert v["reached"] == [] and v["financial_exposure_usd"] == 0 and v["cyber_risk"] == "LOW"


def test_default_what_ifs_generated_when_absent():
    raw = copy.deepcopy(SAMPLE)
    del raw["what_ifs"]
    d, entry = parsed(raw)
    ids = [w["id"] for w in engine.what_ifs(d, entry, engine.compute(d, entry))]
    assert ids == ["cut-e1", "cut-e2", "cut-e3", "gap-payments-core"]


# ---------------------------------------------------------------- lint (/v1/validate)

def _errors(raw):
    r = client.post("/v1/validate", json=raw).json()
    assert r["ok"] is False
    return {e["path"] for e in r["errors"]}


def test_validate_sample_ok():
    r = client.post("/v1/validate", json=SAMPLE).json()
    assert r["ok"] and r["errors"] == [] and r["stats"]["entry"] == "vendor-portal"


def test_validate_dangling_edge():
    raw = copy.deepcopy(SAMPLE)
    raw["edges"][0]["destination"] = "ghost"
    assert "$.edges[0].destination" in _errors(raw)


def test_validate_missing_entry():
    raw = copy.deepcopy(SAMPLE)
    raw["entry"] = "nope"
    assert "$.entry" in _errors(raw)


def test_validate_entry_fallback_to_external_with_allowed_edge():
    raw = copy.deepcopy(SAMPLE)
    del raw["entry"]
    assert lint(raw).entry == "vendor-portal"  # partner-sftp's only edge is denied


def test_validate_duplicate_id():
    raw = copy.deepcopy(SAMPLE)
    raw["nodes"][1]["id"] = "vendor-portal"
    assert "$.nodes[1].id" in _errors(raw)


def test_validate_unknown_field():
    raw = copy.deepcopy(SAMPLE)
    raw["nodes"][0]["colour"] = "red"
    assert "$.nodes[0].colour" in _errors(raw)


def test_validate_oversize_body():
    r = client.post("/v1/validate", content=b'{"x":"' + b"a" * 70_000 + b'"}',
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_validate_warnings_for_unknown_factors():
    raw = copy.deepcopy(SAMPLE)
    del raw["nodes"][6]["mttd_hours"]
    r = client.post("/v1/validate", json=raw).json()
    assert r["ok"] and any("refunds-api" in w["msg"] for w in r["warnings"])


def test_analyze_rejects_invalid_with_422():
    raw = copy.deepcopy(SAMPLE)
    raw["edges"][0]["source"] = "ghost"
    r = client.post("/v1/analyze", json=raw)
    assert r.status_code == 422 and r.json()["detail"]["errors"][0]["path"] == "$.edges[0].source"


# ---------------------------------------------------------------- validator (§4.4)

def test_golden_passes_validation_with_expected_verdicts():
    d, entry = parsed()
    v = engine.compute(d, entry)
    a = golden_analysis()
    hop_checks, kept = checks.validate_hops(d, entry, v["reached"], a)
    assert [h["edge_id"] for h in hop_checks] == ["e1", "e2", "e3"] and all(h["ok"] for h in hop_checks)
    verdicts = [r["verdict"] for r in checks.reasoning_verdicts(d, entry, v["reached"], v, a)]
    assert verdicts == ["accepted", "accepted", "accepted", "corrected", "corrected", "rejected"]


def test_fabricated_hop_rejected():
    d, entry = parsed()
    v = engine.compute(d, entry)
    a = golden_analysis()
    a.paths[0].steps[1].evidence_edge = "e99"
    a.paths[1].steps[1].evidence_edge = "e4"  # denied
    hop_checks, kept = checks.validate_hops(d, entry, v["reached"], a)
    bad = {h["edge_id"]: h["reason"] for h in hop_checks if not h["ok"]}
    assert set(bad) == {"e99", "e4"} and "allowed = false" in bad["e4"]
    assert [s.evidence_edge for s in kept] == ["e1"]


def test_denied_edge_reasoning_rejected():
    d, entry = parsed()
    v = engine.compute(d, entry)
    a = golden_analysis()
    a.reasoning[2].refs.edges = ["e4"]
    assert checks.reasoning_verdicts(d, entry, v["reached"], v, a)[2]["verdict"] == "rejected"


def test_impact_phase_end_overwritten_by_config_mttd():
    d, entry = parsed()
    phases = checks.phases_out(d, engine.compute(d, entry), golden_analysis())
    impact = {p["system"]: p for p in phases if p["impact"]}
    assert impact["payments-core"]["end_h"] == 18 and impact["refunds-api"]["end_h"] == 12
    assert impact["payments-core"]["end_source"] == "config_mttd"


def test_narrative_strips_stray_money():
    d, entry = parsed()
    v = engine.compute(d, entry)
    text = checks.fill_narrative("Loses $9.9M, up to {exposure}.", 3, v, [])
    assert "$9.9M" not in text and "$2,300,000" in text


# ---------------------------------------------------------------- stream

def events(raw=SAMPLE, mode="live"):
    out = []
    with client.stream("POST", f"/v1/analyze?mode={mode}", json=raw) as r:
        assert r.status_code == 200 and r.headers["x-accel-buffering"] == "no"
        for block in r.read().decode().split("\n\n"):
            lines = dict(l.split(": ", 1) for l in block.splitlines() if l and not l.startswith(":"))
            if "event" in lines:
                out.append((lines["event"], json.loads(lines["data"])))
    return out


def stage_ids(evts):
    return [d["id"] for e, d in evts if e == "stage" and d["status"] != "running"]


def test_stream_cached_mode():
    evts = events(mode="cached")
    assert stage_ids(evts) == ["parse", "rank_inputs", "load_golden", "validate_hops",
                               "bfs_crosscheck", "engine", "what_ifs"]
    assert "error" not in [e for e, _ in evts]
    result = evts[-1][1]
    assert evts[-1][0] == "result" and result["source"] == "cached"
    assert result["verdict"]["financial_exposure_usd"] == 2_300_000
    assert result["ai_estimate"]["delta_pct_vs_engine"] == 20
    assert "$2,300,000" in result["narrative"] and "$1,500,000" in result["narrative"]


def test_stream_ai_input_has_no_mttd(monkeypatch):
    for e, d in events(mode="cached"):
        if e == "ai_input":
            blob = json.dumps(d["payload"])
            assert "mttd" not in blob and d["prompt_redactions"] == ["mttd_hours", "mttd_evidence"]


def test_stream_live_mocked(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "live")
    monkeypatch.setenv("GEMINI_API_KEY", "test")

    async def fake(payload):
        return golden_analysis()
    monkeypatch.setattr(ai, "call_gemini", fake)
    evts = events()
    assert stage_ids(evts) == ["parse", "rank_inputs", "gemini_call", "validate_hops",
                               "bfs_crosscheck", "engine", "what_ifs"]
    assert evts[-1][1]["source"] == "live" and evts[-1][1]["fallback"] is None


def _slow(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "live")
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setattr("app.config.GEMINI_TIMEOUT_S", 0.05)

    async def slow(payload):
        await asyncio.sleep(1)
    monkeypatch.setattr(ai, "call_gemini", slow)


def test_stream_timeout_falls_back_to_cached(monkeypatch):
    _slow(monkeypatch)
    evts = events()
    err = next(d for e, d in evts if e == "error")
    assert err == {"stage": "gemini_call", "message": "Gemini timed out", "fallback": "cached"}
    assert evts[-1][1]["source"] == "cached"


def test_stream_custom_input_timeout_is_engine_only(monkeypatch):
    _slow(monkeypatch)
    raw = copy.deepcopy(SAMPLE)
    raw["nodes"][5]["transaction_limit_usd"] = 3_000_000  # different hash: no golden file
    evts = events(raw)
    assert next(d for e, d in evts if e == "error")["fallback"] == "engine_only"
    r = evts[-1][1]
    assert r["source"] == "engine_only" and r["reasoning"] == [] and r["phases"] == []
    assert r["hops"][0]["technique"] == checks.ENGINE_ONLY_TECHNIQUE
    assert r["verdict"]["financial_exposure_usd"] == 3_000_000 * 0.75 * 0.8 + 800_000


def test_golden_hash_ignores_formatting_and_aliases():
    raw = copy.deepcopy(SAMPLE)
    raw["scenario_id"] = raw.pop("scenario")
    raw["rules"] = {"disruption_hours": raw["rules"]["disruption_hours_by_criticality"],
                    "materiality_threshold_usd": 100000}
    assert ai.golden_for(parsed(raw)[0]) is not None


def test_sample_endpoint():
    assert client.get("/v1/sample").json()["scenario"] == "northbank-demo"


# ---------------------------------------------------------------- regressions from a live Gemini run

def test_lateral_through_on_path_node_is_not_rejected():
    d, entry = parsed()
    v = engine.compute(d, entry)
    a = golden_analysis()
    a.reasoning[5].refs = ai.AIRefs(nodes=["vendor-svc-account"], edges=["e2", "e3"])
    hop_nodes = {"vendor-portal", "vendor-svc-account", "payments-core", "refunds-api"}
    assert checks.reasoning_verdicts(d, entry, v["reached"], v, a, hop_nodes)[5]["verdict"] == "accepted"


def test_detection_estimate_resolves_target_from_edge_refs():
    d, entry = parsed()
    v = engine.compute(d, entry)
    a = golden_analysis()
    a.reasoning[3].refs = ai.AIRefs(nodes=[], edges=["e2", "e3"])
    check = checks.reasoning_verdicts(d, entry, v["reached"], v, a)[3]["check"]
    assert "payments-core 18h" in check and "refunds-api 12h" in check


def test_narrative_placeholders_carry_units():
    d, entry = parsed()
    v = engine.compute(d, entry)
    text = checks.fill_narrative("In {hops}, {exposure} in {mttd}, {disruption} at risk.", 3, v, [])
    assert text == "In three hops, $2,300,000 in 18 hours, 72 hours at risk."


def test_detection_estimate_on_non_financial_node_names_config_values():
    d, entry = parsed()
    v = engine.compute(d, entry)
    a = golden_analysis()
    a.reasoning[3].refs = ai.AIRefs(nodes=["vendor-svc-account"], edges=[])
    check = checks.reasoning_verdicts(d, entry, v["reached"], v, a)[3]["check"]
    assert check.startswith("Engine ignores this estimate") and "payments-core 18h" in check
