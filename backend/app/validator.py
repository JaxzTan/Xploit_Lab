"""Path validator: every hop must be a real, allowed edge; systems_reached must be BFS-reachable.

Code BFS is ground truth. Mismatches are logged; BFS wins.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass

from app.engine.exposure import reachable
from app.models import RejectedHop, Scenario, Step, Validation

log = logging.getLogger("fapi.validator")


@dataclass
class ValidationResult:
    validation: Validation
    systems_reached: list[str]  # filtered to the BFS-reachable set (BFS wins)

    @property
    def ok(self) -> bool:
        return not self.validation.rejected_hops and self.validation.hops_total > 0


def validate_path(
    scenario: Scenario, entry_point: str, steps: Sequence[Step], systems_reached: Sequence[str]
) -> ValidationResult:
    edges = {e.edge_id: e for e in scenario.edges}
    bfs = set(reachable(scenario.edges, scenario.entry))
    can_start = bfs | {scenario.entry}
    rejected: list[RejectedHop] = []

    if entry_point != scenario.entry:
        log.warning("%s: model entry_point %r != config entry %r",
                    scenario.id, entry_point, scenario.entry)

    for s in steps:
        e = edges.get(s.evidence_edge)
        reason = None
        if e is None:
            reason = "edge does not exist in bank.json"
        elif not e.allowed:
            reason = "edge exists but allowed=false"
        elif (e.source, e.destination) != (s.from_, s.to):
            reason = f"edge {e.edge_id} connects {e.source}→{e.destination}, not {s.from_}→{s.to}"
        elif s.from_ not in can_start:
            reason = f"{s.from_} is not reachable from entry {scenario.entry}"
        if reason:
            log.warning("%s: rejected hop %s→%s via %s: %s",
                        scenario.id, s.from_, s.to, s.evidence_edge, reason)
            rejected.append(RejectedHop(**{"from": s.from_}, to=s.to,
                                        evidence_edge=s.evidence_edge, reason=reason))

    extra = [n for n in systems_reached if n not in bfs]
    if extra:
        log.warning("%s: systems_reached not in BFS reachable set (BFS wins, dropped): %s",
                    scenario.id, extra)
    kept = [n for n in systems_reached if n in bfs]

    return ValidationResult(
        validation=Validation(
            hops_verified=len(steps) - len(rejected),
            hops_total=len(steps),
            bfs_subset=not extra,
            rejected_hops=rejected,
        ),
        systems_reached=kept,
    )
