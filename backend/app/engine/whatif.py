"""What-if: apply stackable changes to a deep copy and re-run the engine. Never calls Gemini."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from app.engine.exposure import compute, js_round
from app.models import Change, ClearedEvidence, Edge, Node, Scenario, Verdict


class UnknownChangeError(KeyError):
    pass


@dataclass
class Mutated:
    nodes: list[Node]
    edges: list[Edge]
    removed_edges: list[str] = field(default_factory=list)
    cleared_evidence: list[ClearedEvidence] = field(default_factory=list)


def resolve_changes(scenario: Scenario, change_ids: Sequence[str]) -> list[Change]:
    """Map ids to Change objects, in scenario order (like the design), deduplicated."""
    known = {c.id for c in scenario.changes}
    missing = [cid for cid in change_ids if cid not in known]
    if missing:
        raise UnknownChangeError(missing)
    wanted = set(change_ids)
    return [c for c in scenario.changes if c.id in wanted]


def apply_changes(scenario: Scenario, changes: Sequence[Change]) -> Mutated:
    """Port of design `applyChanges()`; works on deep copies, the scenario is never mutated."""
    nodes = [n.model_copy(deep=True) for n in scenario.nodes]
    edges = [e.model_copy(deep=True) for e in scenario.edges]
    out = Mutated(nodes=nodes, edges=edges)
    for c in changes:
        if c.op == "remove_edge":
            out.edges = [e for e in out.edges if e.edge_id != c.target]
            out.removed_edges.append(c.target)
        elif c.op == "clear_evidence":
            for i, n in enumerate(out.nodes):
                if n.id == c.target:
                    out.nodes[i] = n.model_copy(update={c.field: None})
            out.cleared_evidence.append(ClearedEvidence(node_id=c.target, field=c.field or ""))
    return out


def baseline(scenario: Scenario) -> Verdict:
    return compute(scenario.nodes, scenario.edges, scenario.entry, scenario.rules)


@dataclass
class WhatIfResult:
    before: Verdict
    after: Verdict
    avoided_usd: int
    effort_hours: int | float
    removed_edges: list[str]
    cleared_evidence: list[ClearedEvidence]


def what_if(scenario: Scenario, change_ids: Sequence[str]) -> WhatIfResult:
    changes = resolve_changes(scenario, change_ids)
    before = baseline(scenario)
    m = apply_changes(scenario, changes)
    after = compute(m.nodes, m.edges, scenario.entry, scenario.rules)
    return WhatIfResult(
        before=before,
        after=after,
        avoided_usd=js_round(before.financial_exposure_raw - after.financial_exposure_raw),
        effort_hours=sum(c.effort for c in changes),
        removed_edges=m.removed_edges,
        cleared_evidence=m.cleared_evidence,
    )
