import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app import reasoner
from app.main import app
from app.models import AttackPath

client = TestClient(app)
SIDS = ["meridian", "hydra", "lion"]


def test_healthz():
    assert client.get("/healthz").json() == {"status": "ok"}


def test_list_scenarios_order():
    r = client.get("/api/scenarios").json()
    assert [s["id"] for s in r] == SIDS
    assert r[0] == {"id": "meridian", "name": "Meridian Bank",
                    "label": "meridian-bank · 13 nodes · 13 edges"}


@pytest.mark.parametrize("sid", SIDS)
def test_get_scenario_static_only(sid):
    r = client.get(f"/api/scenarios/{sid}").json()
    assert set(r) == {"id", "meta", "entry", "nodes", "edges", "rules", "changes", "source"}
    assert r["source"] == "cached"
    for banned in ("techniques", "hop_details", "phases", "reasoning", "ai_estimate", "narrative"):
        assert banned not in r and banned not in r["meta"]
    assert "R-EXP-1" in r["rules"]["rule_ids"]


def test_unknown_scenario_404():
    assert client.get("/api/scenarios/nope").status_code == 404
    assert client.post("/api/analyze", json={"scenario_id": "nope"}).status_code == 404
    assert client.post("/api/what-if", json={"scenario_id": "nope"}).status_code == 404


def test_unknown_change_422():
    r = client.post("/api/what-if", json={"scenario_id": "meridian", "change_ids": ["x"]})
    assert r.status_code == 422


@pytest.mark.parametrize("sid", SIDS)
def test_analyze_cached(sid, bundles):
    r = client.post("/api/analyze", json={"scenario_id": sid}).json()
    g = bundles[sid].golden
    assert r["source"] == "cached" and r["fallback_reason"] == "demo_mode"
    assert r["path"]["path_edge_ids"] == g.path_edge_ids
    assert r["path"]["on_path"] == g.on_path
    assert set(r["path"]["steps"][0]) == {"from", "to", "technique", "evidence_edge"}
    assert r["validation"]["hops_verified"] == r["validation"]["hops_total"] == len(g.steps)
    assert "{" not in r["narrative"] and "{exposure}" in r["narrative_template"]
    assert f"${r['verdict']['financial_exposure_usd']:,}" in r["narrative"]


def test_analyze_no_key(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "live")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API", raising=False)
    r = client.post("/api/analyze", json={"scenario_id": "hydra"}).json()
    assert r["source"] == "cached" and r["fallback_reason"] == "no_api_key"


def _live(monkeypatch, fake):
    monkeypatch.setenv("DEMO_MODE", "live")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(reasoner, "_call_gemini", fake)


def test_live_success(monkeypatch, bundles):
    g = bundles["meridian"].golden

    async def fake(scenario, key):
        return AttackPath(entry_point=scenario.entry, steps=g.steps,
                          systems_reached=g.systems_reached,
                          narrative="Up to {exposure} at risk for {disruption} hours.")

    _live(monkeypatch, fake)
    r = client.post("/api/analyze", json={"scenario_id": "meridian"}).json()
    assert r["source"] == "live" and r["fallback_reason"] is None
    assert r["narrative"] == "Up to $2,400,000 at risk for 68 hours."
    assert r["path"]["path_edge_ids"] == g.path_edge_ids


def test_live_fabricated_hop_falls_back(monkeypatch, bundles):
    g = bundles["meridian"].golden
    bad = g.steps[0].model_copy(update={"evidence_edge": "e99"})

    async def fake(scenario, key):
        return AttackPath(entry_point=scenario.entry, steps=[bad, *g.steps[1:]],
                          systems_reached=[], narrative="{exposure} {disruption}")

    _live(monkeypatch, fake)
    r = client.post("/api/analyze", json={"scenario_id": "meridian"}).json()
    assert r["source"] == "cached" and r["fallback_reason"] == "validation_failed"
    assert r["validation"]["rejected_hops"][0]["evidence_edge"] == "e99"
    assert r["path"]["path_edge_ids"] == g.path_edge_ids


@pytest.mark.parametrize("exc,reason", [(asyncio.TimeoutError(), "timeout"),
                                        (RuntimeError("boom"), "error")])
def test_live_errors_fall_back(monkeypatch, exc, reason):
    async def fake(scenario, key):
        raise exc

    _live(monkeypatch, fake)
    r = client.post("/api/analyze", json={"scenario_id": "lion"}).json()
    assert r["source"] == "cached" and r["fallback_reason"] == reason


def test_live_slow_call_times_out(monkeypatch):
    monkeypatch.setattr(reasoner.config, "GEMINI_TIMEOUT_S", 0.05)

    async def fake(scenario, key):
        await asyncio.sleep(1)

    _live(monkeypatch, fake)
    r = client.post("/api/analyze", json={"scenario_id": "hydra"}).json()
    assert r["fallback_reason"] == "timeout"


def test_live_numbers_in_narrative_rejected(monkeypatch, bundles):
    g = bundles["hydra"].golden

    async def fake(scenario, key):
        return AttackPath(entry_point=scenario.entry, steps=g.steps,
                          systems_reached=g.systems_reached, narrative="Up to $9M is at risk.")

    _live(monkeypatch, fake)
    r = client.post("/api/analyze", json={"scenario_id": "hydra"}).json()
    assert r["source"] == "live"
    assert r["narrative_template"] == g.narrative_template


@pytest.mark.parametrize("sid", SIDS)
def test_prompt_graph_has_no_dollar_or_detection_fields(sid, bundles):
    blob = json.dumps(reasoner.sanitized_graph(bundles[sid].scenario))
    for banned in ("exposed_capacity", "detection_delay", "control_multiplier", "$"):
        assert banned not in blob


def test_whatif_endpoint_shape():
    r = client.post("/api/what-if", json={"scenario_id": "meridian",
                                          "change_ids": ["revoke-payment-write", "clear-evidence"]})
    body = r.json()
    assert r.status_code == 200
    assert body["before"]["financial_exposure_usd"] == 2_400_000
    assert body["after"]["financial_exposure_usd"] == 0
    assert body["avoided_usd"] == 2_400_000 and body["effort_hours"] == 1
    assert body["removed_edges"] == ["e6"]
    assert body["cleared_evidence"] == [{"node_id": "payments-core",
                                         "field": "detection_delay_hours"}]


def test_spa_fallback(tmp_path, monkeypatch):
    from app import main

    (tmp_path / "index.html").write_text("<html>spa</html>")
    (tmp_path / "app.js").write_text("js")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)
    assert client.get("/").text == "<html>spa</html>"
    assert client.get("/some/route").text == "<html>spa</html>"
    assert client.get("/app.js").text == "js"
    assert client.get("/api/nope").status_code == 404
