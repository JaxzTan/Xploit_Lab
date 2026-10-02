"""Engine parity with the design guide's JS compute(), plus rule-level table tests (TRD §9)."""

import ast
import inspect

import pytest

from app.engine import exposure
from app.engine.exposure import best_bypass, compute, js_round, reachable, usd
from app.engine.whatif import apply_changes, resolve_changes
from app.models import Edge, Node, Rules
from tests.conftest import js_cases

CASES = js_cases()


@pytest.mark.parametrize(
    "sid,change_ids,js", CASES, ids=[f"{s}:{'+'.join(c) or 'baseline'}" for s, c, _ in CASES]
)
def test_engine_matches_design_js(bundles, sid, change_ids, js):
    sc = bundles[sid].scenario
    m = apply_changes(sc, resolve_changes(sc, change_ids))
    v = compute(m.nodes, m.edges, sc.entry, sc.rules)

    assert v.financial_exposure_raw == js["total"]  # bit-exact float parity
    assert v.financial_exposure_usd == js_round(js["total"])
    assert v.disruption_hours == js["disruption"]
    assert v.cyber_risk == js["cyber"]
    assert v.regulatory_status == js["regulatory"]
    assert v.complete == js["complete"]
    assert v.critical_financial_count == js["critical_financial_count"]
    assert v.reached == js["reached"]
    got = [
        (p.node_id, p.detection_window_factor, p.gap_unknown, p.control_multiplier, p.chain,
         p.bypass_unknown, p.exposure_raw)
        for p in v.per_system
    ]
    want = [
        (p["node_id"], p["gap"], p["gap_unknown"], p["bypass"], p["chain"], p["bypass_unknown"],
         p["exposure"])
        for p in js["per_system"]
    ]
    assert got == want


# Headline numbers, frozen from the design guide (before → after the primary fix).
@pytest.mark.parametrize(
    "sid,change,before,after,dis_before,dis_after",
    [
        ("meridian", "revoke-payment-write", 2_400_000, 0, 68, 68),
        ("hydra", "revoke-ach-originate", 4_100_000, 0, 48, 24),
        ("lion", "revoke-card-scope", 4_670_000, 1_670_000, 96, 72),
        ("lion", "swift-dual-approval", 4_670_000, 3_000_000, 96, 72),
    ],
)
def test_headline_numbers(bundles, sid, change, before, after, dis_before, dis_after):
    from app.engine.whatif import what_if

    r = what_if(bundles[sid].scenario, [change])
    assert r.before.financial_exposure_usd == before
    assert r.after.financial_exposure_usd == after
    assert r.before.disruption_hours == dis_before
    assert r.after.disruption_hours == dis_after
    assert r.avoided_usd == before - after


# ---------------------------------------------------------------- rule-level tables

RULES = Rules.model_validate(
    {"disruption": {"critical": 72, "high": 24, "medium": 8, "multi_critical": 96}}
)


def node(id, crit="medium", type="service", **kw):
    return Node(id=id, name=id, type=type, criticality=crit, x=0, y=0, **kw)


def edge(eid, s, d, allowed=True, m=1.0):
    return Edge(edge_id=eid, source=s, destination=d, permission="p", allowed=allowed,
                control_multiplier=m)


def fin(id, cap, delay, crit="critical", cf=True):
    return node(id, crit, "financial", critical_function=cf,
                exposed_capacity_24h_usd=cap, detection_delay_hours=delay)


@pytest.mark.parametrize(
    "delay,factor",
    [(0, 0.0), (6, 0.25), (12, 0.5), (18, 0.75), (24, 1.0), (48, 1.0), (None, 1.0)],
)
def test_detection_window_factor(delay, factor):  # R-WIN-1 / R-UNK-1
    nodes = [node("a"), fin("f", 1_000_000, delay)]
    v = compute(nodes, [edge("e1", "a", "f")], "a", RULES)
    p = v.per_system[0]
    assert p.detection_window_factor == factor
    assert p.gap_unknown == (delay is None)
    assert v.complete == (delay is not None)
    assert v.financial_exposure_usd == js_round(1_000_000 * factor)


def test_best_bypass_takes_max_product_over_simple_paths():  # R-BYP-1
    edges = [edge("e1", "a", "b", m=0.5), edge("e2", "b", "f", m=0.5),
             edge("e3", "a", "c", m=0.9), edge("e4", "c", "f", m=0.8),
             edge("e5", "a", "f", allowed=False, m=1.0)]
    bp = best_bypass(edges, "a", "f")
    assert bp.value == pytest.approx(0.72)
    assert bp.chain == ["e3", "e4"]
    assert not bp.unknown


def test_missing_multiplier_is_unknown_not_safe():  # R-UNK-1
    edges = [edge("e1", "a", "f", m=None)]
    v = compute([node("a"), fin("f", 2_000_000, 24)], edges, "a", RULES)
    assert v.per_system[0].control_multiplier == 1.0
    assert v.per_system[0].bypass_unknown
    assert v.complete is False
    assert v.financial_exposure_usd == 2_000_000
    assert any(r.unknown and r.rule_id == "R-UNK-1" for r in v.evidence)


@pytest.mark.parametrize(
    "reached_nodes,expected_dis,expected_cyber",
    [
        ([node("m", "medium")], 8, "LOW"),
        ([node("h", "high")], 24, "MEDIUM"),
        ([node("c", "critical")], 72, "HIGH"),
        ([fin("f1", 1, 24)], 72, "HIGH"),
        ([fin("f1", 1, 24), fin("f2", 1, 24)], 96, "HIGH"),
        ([fin("f1", 1, 24, crit="high", cf=False)], 24, "MEDIUM"),
    ],
)
def test_disruption_and_cyber(reached_nodes, expected_dis, expected_cyber):  # R-DIS-1, R-CYB-1
    edges = [edge(f"e{i}", "a", n.id) for i, n in enumerate(reached_nodes)]
    v = compute([node("a", "low"), *reached_nodes], edges, "a", RULES)
    assert v.disruption_hours == expected_dis
    assert v.cyber_risk == expected_cyber


@pytest.mark.parametrize(
    "target,expected",
    [
        (fin("f", 50_000, 24, crit="critical", cf=True), "MAJOR"),  # not a dollar threshold
        (fin("f", 9_000_000, 24, crit="high", cf=False), "BELOW"),
        (node("c", "critical"), "BELOW"),
    ],
)
def test_regulatory(target, expected):  # R-REG-1
    v = compute([node("a"), target], [edge("e1", "a", target.id)], "a", RULES)
    assert v.regulatory_status == expected


def test_denied_edges_are_not_traversed_and_entry_not_reached():
    edges = [edge("e1", "a", "b"), edge("e2", "b", "c", allowed=False)]
    assert reachable(edges, "a") == ["b"]


def test_evidence_rows_carry_rule_ids_and_multiply_out(bundles):
    for b in bundles.values():
        v = compute(b.scenario.nodes, b.scenario.edges, b.scenario.entry, b.scenario.rules)
        assert all(r.rule_id.startswith("R-") for r in v.evidence)
        for p in v.per_system:
            assert p.exposure_raw == (p.exposed_capacity_24h_usd * p.detection_window_factor
                                      * p.control_multiplier)
        assert v.financial_exposure_raw == pytest.approx(sum(p.exposure_raw for p in v.per_system))


def test_usd_matches_js_formatting():
    assert usd(2_400_000) == "$2,400,000"
    assert usd(0.5) == "$1"  # Math.round, not banker's rounding
    assert usd(2.5) == "$3"


def test_engine_module_has_no_io_or_network_imports():
    tree = ast.parse(inspect.getsource(exposure))
    mods = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    mods |= {n.module.split(".")[0] for n in ast.walk(tree)
             if isinstance(n, ast.ImportFrom) and n.module}
    assert not mods & {"google", "httpx", "requests", "socket", "urllib", "os", "io", "pathlib"}
