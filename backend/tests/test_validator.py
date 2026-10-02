import pytest

from app.models import Step
from app.validator import validate_path


def step(f, t, e, tech="x"):
    return Step(**{"from": f}, to=t, technique=tech, evidence_edge=e)


@pytest.mark.parametrize("sid", ["meridian", "hydra", "lion"])
def test_golden_path_passes(bundles, sid):
    b = bundles[sid]
    r = validate_path(b.scenario, b.golden.entry_point, b.golden.steps, b.golden.systems_reached)
    assert r.ok and r.validation.bfs_subset
    assert r.validation.hops_verified == r.validation.hops_total == len(b.golden.path_edge_ids)


@pytest.mark.parametrize(
    "bad,reason",
    [
        (step("clearpay-inbox", "swift-gateway", "e99"), "does not exist"),       # invented edge
        (step("vendor-int-gateway", "refunds-api", "e8"), "allowed=false"),      # denied edge
        (step("clearpay-inbox", "payments-core", "e1"), "connects"),             # wrong endpoints
        (step("partner-sftp", "swift-gateway", "e10"), "allowed=false"),
    ],
)
def test_fabricated_hop_rejected(bundles, bad, reason):
    b = bundles["meridian"]
    steps = [*b.golden.steps, bad]
    r = validate_path(b.scenario, b.scenario.entry, steps, b.golden.systems_reached)
    assert not r.ok
    assert len(r.validation.rejected_hops) == 1
    assert reason in r.validation.rejected_hops[0].reason
    assert r.validation.hops_verified == len(steps) - 1


def test_unreachable_start_rejected(bundles):
    # e11 is allowed, but in a graph where payments-core is cut off its source is unreachable
    from app.engine.whatif import apply_changes, resolve_changes

    sc = bundles["meridian"].scenario
    m = apply_changes(sc, resolve_changes(sc, ["revoke-payment-write"]))
    cut = sc.model_copy(update={"edges": m.edges})
    r = validate_path(cut, sc.entry, [step("payments-core", "core-ledger-db", "e11")], [])
    assert not r.ok and "not reachable" in r.validation.rejected_hops[0].reason


def test_systems_reached_bfs_wins(bundles):
    b = bundles["meridian"]
    r = validate_path(b.scenario, b.scenario.entry, b.golden.steps,
                      [*b.golden.systems_reached, "treasury-ledger"])
    assert r.ok  # hops are fine
    assert r.validation.bfs_subset is False
    assert "treasury-ledger" not in r.systems_reached
