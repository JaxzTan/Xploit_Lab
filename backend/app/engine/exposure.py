"""Exposure engine — exact port of the design guide's `bfs()`, `bestBypass()` and `compute()`.

Pure functions: no I/O, no network, no LLM. Same graph in => identical verdict out.
Every number carries a rule ID (see rules.rule_ids in bank.json).
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass

import networkx as nx

from app.models import Edge, EvidenceRow, Node, PerSystem, Rules, Verdict


def js_round(x: float) -> int:
    """JavaScript Math.round (half rounds toward +inf), not Python's banker's rounding."""
    return int(math.floor(x + 0.5))


def usd(x: float) -> str:
    """Design guide `usd()`: '$' + Math.round(n).toLocaleString('en-US')."""
    n = js_round(x)
    return ("-$" if n < 0 else "$") + f"{abs(n):,}"


def build_graph(edges: Sequence[Edge]) -> nx.MultiDiGraph:
    """Directed multigraph of ALLOWED edges only, keyed by edge_id, in config order."""
    g = nx.MultiDiGraph()
    for e in edges:
        if e.allowed:
            g.add_edge(e.source, e.destination, key=e.edge_id, edge=e)
    return g


def _adjacency(edges: Sequence[Edge]) -> dict[str, list[Edge]]:
    # Edge-list order per source, exactly as the design's `adj` is built (tie-breaks depend on it).
    adj: dict[str, list[Edge]] = {}
    for e in edges:
        if e.allowed:
            adj.setdefault(e.source, []).append(e)
    return adj


def reachable(edges: Sequence[Edge], entry: str) -> list[str]:
    """BFS from entry over allowed edges, in discovery order.

    Like the design guide, the entry itself is NOT included unless a cycle leads back to it.
    """
    g = build_graph(edges)
    if entry not in g:
        return []
    reached: dict[str, None] = {}
    q = deque([entry])
    while q:
        n = q.popleft()
        for succ in g.successors(n):  # first-insertion order == design's adj order
            if succ not in reached:
                reached[succ] = None
                q.append(succ)
    return list(reached)


@dataclass(frozen=True)
class Bypass:
    value: float
    unknown: bool
    chain: list[str]


def best_bypass(edges: Sequence[Edge], entry: str, target: str) -> Bypass:
    """R-BYP-1: max over simple paths entry→target of the product of control_multiplier.

    A missing multiplier counts as 1.0 and marks the path UNKNOWN (R-UNK-1). Ties keep the
    first path found in DFS order (strictly-greater comparison, as in the design).
    """
    adj = _adjacency(edges)
    best, unknown, chain = 0.0, False, []

    def walk(n: str, prod: float, seen: frozenset[str], ids: list[str], saw_unknown: bool) -> None:
        nonlocal best, unknown, chain
        if n == target:
            if prod > best:
                best, unknown, chain = prod, saw_unknown, list(ids)
            return
        for e in adj.get(n, []):
            if e.destination in seen:
                continue
            has_p = e.control_multiplier is not None
            walk(
                e.destination,
                prod * (e.control_multiplier if has_p else 1),
                seen | {e.destination},
                [*ids, e.edge_id],
                saw_unknown or not has_p,
            )

    walk(entry, 1, frozenset({entry}), [], False)
    return Bypass(best, unknown, chain)


def compute(nodes: Sequence[Node], edges: Sequence[Edge], entry: str, rules: Rules) -> Verdict:
    """Port of design `compute()` plus evidence rows with rule IDs."""
    by_id = {n.id: n for n in nodes}
    reached = reachable(edges, entry)
    reached_set = set(reached)
    dis = rules.disruption

    per_system: list[PerSystem] = []
    evidence: list[EvidenceRow] = []
    total = 0.0
    complete = True
    critical_financial_count = 0

    for n in nodes:  # node order, as in the design
        if n.id not in reached_set or n.type != "financial" or n.exposed_capacity_24h_usd is None:
            continue
        gap_unknown = n.detection_delay_hours is None
        gap = 1 if gap_unknown else min(n.detection_delay_hours / 24, 1)
        bp = best_bypass(edges, entry, n.id)
        if gap_unknown or bp.unknown:
            complete = False
        exposure = n.exposed_capacity_24h_usd * gap * bp.value  # R-EXP-1
        total += exposure
        if n.criticality == "critical" and n.critical_function:
            critical_financial_count += 1
        per_system.append(
            PerSystem(
                node_id=n.id,
                exposed_capacity_24h_usd=n.exposed_capacity_24h_usd,
                detection_delay_hours=n.detection_delay_hours,
                detection_window_factor=float(gap),
                gap_unknown=gap_unknown,
                control_multiplier=float(bp.value),
                chain=bp.chain,
                bypass_unknown=bp.unknown,
                exposure_usd=js_round(exposure),
                exposure_raw=exposure,
            )
        )
        evidence += [
            EvidenceRow(
                factor=f"exposed_capacity_24h · {n.name}",
                value=usd(n.exposed_capacity_24h_usd),
                source=f"node:{n.id}",
                rule_id="R-EXP-1",
            ),
            EvidenceRow(
                factor=f"detection_window_factor · {n.name}",
                value="UNKNOWN → 1.00" if gap_unknown else f"{gap:.2f}",
                source=f"node:{n.id}",
                rule_id="R-UNK-1" if gap_unknown else "R-WIN-1",
                unknown=gap_unknown,
                note=n.detection_delay_evidence or "no detection_delay_evidence on record",
            ),
            EvidenceRow(
                factor=f"control_multiplier · {n.name}",
                value=f"{bp.value:.2f}",
                source=" × ".join(f"edge:{eid}" for eid in bp.chain),
                rule_id="R-UNK-1" if bp.unknown else "R-BYP-1",
                unknown=bp.unknown,
                note="edge.control_multiplier " + " × ".join(bp.chain),
            ),
            EvidenceRow(
                factor=f"exposure · {n.name}",
                value=usd(exposure),
                source=f"node:{n.id}",
                rule_id="R-EXP-1",
                unknown=gap_unknown or bp.unknown,
                note="exposed_capacity_24h × detection_window_factor × control_multiplier",
            ),
        ]

    # R-DIS-1 / R-CYB-1 / R-REG-1
    tier = {"critical": dis.critical, "high": dis.high, "medium": dis.medium}
    disruption: int | float = 0
    any_critical = any_high = unauthorized_critical_payment = False
    for nid in reached:
        n = by_id[nid]
        disruption = max(disruption, tier.get(n.criticality) or 0)
        any_critical = any_critical or n.criticality == "critical"
        any_high = any_high or n.criticality == "high"
        if n.critical_function and n.type == "financial":
            unauthorized_critical_payment = True
    if critical_financial_count >= 2:
        disruption = max(disruption, dis.multi_critical or 96)
    elif critical_financial_count == 1:
        disruption = max(disruption, dis.critical or 72)

    cyber = "HIGH" if any_critical else "MEDIUM" if any_high else "LOW"
    regulatory = "MAJOR" if unauthorized_critical_payment else "BELOW"

    if critical_financial_count >= 2:
        dis_note = f"rules.json → 2+ critical financial systems ⇒ {disruption}h (recovery-policy)"
    elif critical_financial_count == 1:
        dis_note = f"rules.json → 1 critical financial system ⇒ {disruption}h"
    else:
        dis_note = f"rules.json → highest criticality tier among reached nodes ⇒ {disruption}h"
    evidence += [
        EvidenceRow(
            factor="disruption_hours", value=f"{disruption}h", source="rules.json",
            rule_id="R-DIS-1", note=dis_note,
        ),
        EvidenceRow(
            factor="cyber_risk", value=cyber, source="rules.json",
            rule_id="R-CYB-1", note="highest criticality among reached nodes",
        ),
        EvidenceRow(
            factor="dora_classification",
            value="Major ICT-related incident (simulated)" if regulatory == "MAJOR"
            else "Below classification",
            source="rules.json",
            rule_id="R-REG-1",
            note="EU-covered entity ∧ malicious unauthorized access to a critical payment service",
        ),
    ]

    return Verdict(
        cyber_risk=cyber,
        financial_exposure_usd=js_round(total),
        financial_exposure_raw=total,
        disruption_hours=disruption,
        regulatory_status=regulatory,
        complete=complete,
        critical_financial_count=critical_financial_count,
        reached=reached,
        per_system=per_system,
        evidence=evidence,
    )
