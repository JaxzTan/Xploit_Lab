"""v1 exposure engine: rules D-1 to D-5 (TRD_V2 §4.2) and precomputed what-ifs (TR-7).

Pure functions over a `ScenarioInput`. No I/O, no network, no model output.

    D-1  limit(s)         = node.transaction_limit_usd
    D-2  detection_gap(s) = min(mttd_hours / 24, 1.0)              missing → UNKNOWN → 1.0
    D-3  path_bypass(s)   = max over simple paths entry→s of Π edge.control_bypass_probability
         exposure(s)      = limit × detection_gap × path_bypass
    D-4  disruption       = max disruption_hours[criticality] over ALL reached nodes
         cyber_risk       = HIGH if any critical reached; MEDIUM if any high; else LOW
    D-5  regulatory       = MATERIAL if any critical_function reached AND total ≥ threshold
         complete         = false if any UNKNOWN factor was used
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from app.v1.schema import EdgeIn, NodeIn, ScenarioInput, WhatIfIn

RULE_TEXT = {
    "D-1": "limit = node.transaction_limit_usd",
    "D-2": "detection_gap = min(mttd_hours / 24, 1.0)",
    "D-3": "path_bypass = max over paths of Π control_bypass_probability",
    "D-4": "disruption = max disruption_hours[criticality] over reached",
    "D-5": "regulatory = MATERIAL if critical_function reached ∧ total ≥ threshold",
}


def js_round(x: float) -> int:
    return int(math.floor(x + 0.5))


def usd(x: float) -> str:
    n = js_round(x)
    return ("-$" if n < 0 else "$") + f"{abs(n):,}"


def fmt_p(p: float) -> str:
    """Probability for formulas: up to 3 decimals, no trailing zeros (design `pr()`)."""
    return f"{round(p, 3):g}"


def _adjacency(edges: list[EdgeIn]) -> dict[str, list[EdgeIn]]:
    adj: dict[str, list[EdgeIn]] = {}
    for e in edges:
        if e.allowed:
            adj.setdefault(e.source, []).append(e)
    return adj


def reach(edges: list[EdgeIn], entry: str) -> list[str]:
    """BFS over allowed edges, in discovery order. The entry is not included."""
    adj = _adjacency(edges)
    seen: dict[str, None] = {}
    q = deque([entry])
    while q:
        for e in adj.get(q.popleft(), []):
            if e.destination not in seen and e.destination != entry:
                seen[e.destination] = None
                q.append(e.destination)
    return list(seen)


@dataclass(frozen=True)
class BestPath:
    value: float
    unknown: bool
    chain: list[str]


def best_path(edges: list[EdgeIn], entry: str, target: str) -> BestPath | None:
    """D-3: the simple path entry→target with the highest product of bypass probabilities.

    Ties keep the first path found in edge-list DFS order. None if unreachable.
    """
    adj = _adjacency(edges)
    best: BestPath | None = None

    def walk(n: str, prod: float, seen: frozenset[str], ids: list[str], unknown: bool) -> None:
        nonlocal best
        if n == target:
            if best is None or prod > best.value:
                best = BestPath(prod, unknown, list(ids))
            return
        for e in adj.get(n, []):
            if e.destination in seen:
                continue
            p = e.control_bypass_probability
            walk(e.destination, prod * (1.0 if p is None else p), seen | {e.destination},
                 [*ids, e.edge_id], unknown or p is None)

    walk(entry, 1.0, frozenset({entry}), [], False)
    return best


def compute(d: ScenarioInput, entry: str) -> dict:
    """Full verdict for one graph: per-system exposure, D-4/D-5 verdicts, evidence ledger."""
    by_id = {n.id: n for n in d.nodes}
    edge_by_id = {e.edge_id: e for e in d.edges}
    reached = reach(d.edges, entry)
    reached_set = set(reached)
    dis = d.rules.disruption_hours
    tier = {"critical": dis.critical, "high": dis.high, "medium": dis.medium, "low": dis.low}
    threshold = d.rules.materiality_threshold_usd

    per_system: list[dict] = []
    evidence: list[dict] = []
    total = 0.0
    complete = True
    for n in d.nodes:
        if n.id not in reached_set or n.type != "financial" or n.transaction_limit_usd is None:
            continue
        bp = best_path(d.edges, entry, n.id)
        if bp is None:  # reachable by BFS implies a simple path exists; defensive only
            continue
        gap_unknown = n.mttd_hours is None
        gap = 1.0 if gap_unknown else min(n.mttd_hours / 24, 1.0)
        exposure = n.transaction_limit_usd * gap * bp.value
        total += exposure
        complete = complete and not gap_unknown and not bp.unknown
        probs = [edge_by_id[eid].control_bypass_probability for eid in bp.chain]
        per_system.append({
            "node_id": n.id,
            "criticality": n.criticality,
            "critical_function": n.critical_function,
            "limit": n.transaction_limit_usd,
            "mttd_h": n.mttd_hours,
            "gap": gap,
            "gap_unknown": gap_unknown,
            "bypass": bp.value,
            "bypass_unknown": bp.unknown,
            "chain": bp.chain,
            "chain_probs": [1.0 if p is None else p for p in probs],
            "route": [entry, *(edge_by_id[eid].destination for eid in bp.chain)],
            "exposure": exposure,
            "over_threshold": exposure >= threshold,
            "disruption_h": tier.get(n.criticality, 0),
        })
        evidence += [
            {"factor": f"transaction_limit · {n.id}", "value": usd(n.transaction_limit_usd),
             "source": f"input → nodes[{n.id}].transaction_limit_usd", "rule_id": "D-1",
             "unknown": False},
            {"factor": f"detection_gap · {n.id}",
             "value": "UNKNOWN → 1.00" if gap_unknown else f"{gap:.2f}",
             "source": (n.mttd_evidence or f"input → mttd_hours {n.mttd_hours:g}h (no evidence text)")
             if not gap_unknown else "no mttd_hours on record",
             "rule_id": "D-2", "unknown": gap_unknown},
            {"factor": f"path_bypass · {n.id}",
             "value": f"{bp.value:.2f}" + (" · UNKNOWN" if bp.unknown else ""),
             "source": "edge.control_bypass_probability " + " × ".join(bp.chain),
             "rule_id": "D-3", "unknown": bp.unknown},
        ]
    per_system.sort(key=lambda p: -p["exposure"])

    disruption = 0.0
    any_critical = any_high = critical_fn = False
    for nid in reached:
        n = by_id[nid]
        disruption = max(disruption, tier.get(n.criticality, 0))
        any_critical = any_critical or n.criticality == "critical"
        any_high = any_high or n.criticality == "high"
        critical_fn = critical_fn or n.critical_function
    cyber = "HIGH" if any_critical else "MEDIUM" if any_high else "LOW"
    regulatory = "MATERIAL" if critical_fn and total >= threshold else "BELOW"

    evidence += [
        {"factor": "disruption_hours", "value": f"{disruption:g}h",
         "source": "rules.disruption_hours by criticality, max over reached nodes",
         "rule_id": "D-4", "unknown": False},
        {"factor": "cyber_risk", "value": cyber, "source": "highest criticality among reached nodes",
         "rule_id": "D-4", "unknown": False},
        {"factor": "regulatory_status", "value": regulatory,
         "source": f"critical_function reached ∧ total ≥ {usd(threshold)}", "rule_id": "D-5",
         "unknown": False},
    ]
    return {
        "cyber_risk": cyber,
        "financial_exposure_usd": total,
        "disruption_hours": disruption,
        "regulatory_status": regulatory,
        "complete": complete,
        "threshold_usd": threshold,
        "reached": reached,
        "per_system": per_system,
        "evidence": evidence,
    }


def summary(v: dict) -> dict:
    keys = ("cyber_risk", "financial_exposure_usd", "disruption_hours", "regulatory_status", "complete")
    return {k: v[k] for k in keys}


def default_what_ifs(d: ScenarioInput, verdict: dict) -> list[WhatIfIn]:
    """When the input has no `what_ifs`: cut each edge on the best paths, plus one evidence gap.

    Effort is unknown for generated changes, so "per engineering hour" shows "—".
    """
    edge_by_id = {e.edge_id: e for e in d.edges}
    out: list[WhatIfIn] = []
    seen: set[str] = set()
    for p in verdict["per_system"]:
        for eid in p["chain"]:
            if eid in seen or len(out) >= 3:
                continue
            seen.add(eid)
            e = edge_by_id[eid]
            out.append(WhatIfIn(id=f"cut-{eid}", label=f"Revoke {e.permission or eid}",
                                op="remove_edge", target=eid, effort_hours=0,
                                note=f"Generated: cuts {e.source} → {e.destination}. Effort not set."))
    gap = next((p for p in verdict["per_system"] if not p["gap_unknown"]), None)
    if gap:
        out.append(WhatIfIn(id=f"gap-{gap['node_id']}", label=f"Evidence gap: {gap['node_id']} MTTD unknown",
                            op="clear_evidence", target=gap["node_id"], field="mttd_hours",
                            effort_hours=0, note="What the verdict looks like when a factor has no evidence behind it."))
    return out


def apply_change(d: ScenarioInput, w: WhatIfIn) -> ScenarioInput:
    """Deep copy, then one mutation. The input graph is never touched."""
    c = d.model_copy(deep=True)
    if w.op == "remove_edge":
        c.edges = [e for e in c.edges if e.edge_id != w.target]
    else:
        for item in (*c.nodes, *c.edges):
            ident = item.id if isinstance(item, NodeIn) else item.edge_id
            if ident == w.target and w.field in type(item).model_fields:
                setattr(item, w.field, None)
    return c


def what_ifs(d: ScenarioInput, entry: str, before: dict) -> list[dict]:
    changes = d.what_ifs if d.what_ifs is not None else default_what_ifs(d, before)
    out = []
    for w in changes:
        after = compute(apply_change(d, w), entry)
        avoided = before["financial_exposure_usd"] - after["financial_exposure_usd"]
        per_hour = avoided / w.effort_hours if w.effort_hours > 0 and avoided > 0 else None
        out.append({
            "id": w.id, "label": w.label, "op": w.op, "target": w.target, "field": w.field,
            "note": w.note, "effort_hours": w.effort_hours,
            "after": summary(after),
            "avoided_usd": avoided,
            "per_hour_usd": per_hour,
            "removed_edges": [w.target] if w.op == "remove_edge" else [],
            "cleared": [{"target": w.target, "field": w.field}] if w.op == "clear_evidence" else [],
        })
    return out
