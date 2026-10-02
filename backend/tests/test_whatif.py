import pytest

from app.engine.exposure import reachable
from app.engine.whatif import UnknownChangeError, apply_changes, resolve_changes, what_if


def test_original_never_mutated(bundles):
    for b in bundles.values():
        sc = b.scenario
        snapshot = sc.model_dump()
        what_if(sc, [c.id for c in sc.changes])
        assert sc.model_dump() == snapshot


def test_remove_e6_makes_payments_core_unreachable(bundles):
    sc = bundles["meridian"].scenario
    m = apply_changes(sc, resolve_changes(sc, ["revoke-payment-write"]))
    assert "payments-core" in reachable(sc.edges, sc.entry)
    assert "payments-core" not in reachable(m.edges, sc.entry)
    assert m.removed_edges == ["e6"]


def test_clear_evidence_sets_unknown(bundles):
    sc = bundles["lion"].scenario
    r = what_if(sc, ["clear-evidence"])
    assert r.cleared_evidence[0].node_id == "card-issuing-api"
    assert r.after.complete is False
    assert r.after.financial_exposure_usd == 5_670_000  # "up to" — card branch at full ceiling
    assert r.avoided_usd == -1_000_000


def test_stacking_and_effort(bundles):
    sc = bundles["lion"].scenario
    r = what_if(sc, ["swift-dual-approval", "revoke-card-scope"])
    assert r.after.financial_exposure_usd == 0
    assert r.avoided_usd == 4_670_000
    assert r.effort_hours == sum(c.effort for c in sc.changes
                                 if c.id in {"swift-dual-approval", "revoke-card-scope"})
    assert sorted(r.removed_edges) == ["e4", "e6"]


def test_empty_change_list_after_equals_before(bundles):
    r = what_if(bundles["hydra"].scenario, [])
    assert r.after == r.before and r.avoided_usd == 0 and r.effort_hours == 0


def test_unknown_change_rejected(bundles):
    with pytest.raises(UnknownChangeError):
        what_if(bundles["hydra"].scenario, ["not-a-change"])
