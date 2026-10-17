"""Validator for the model's `AttackAnalysis` (TRD_V2 TR-5, §4.4) and the result pieces built
from it: verified hops, reasoning verdicts, phases with config-MTTD overrides, narrative.

Code BFS and the engine are ground truth; the model's output only survives if it agrees.
"""

from __future__ import annotations

import re

from app.v1.ai import AttackAnalysis, AIStep
from app.v1.engine import usd
from app.v1.schema import ScenarioInput

ENGINE_ONLY_TECHNIQUE = "not named (AI unavailable)"
_MONEY = re.compile(r"[$€£]\s?\d[\d,.]*\s?(?:[kKmMbB]n?\b|million|billion)?")
_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]


def _num_word(n: int) -> str:
    return _WORDS[n] if 0 <= n < len(_WORDS) else str(n)


def validate_hops(d: ScenarioInput, entry: str, reached: list[str],
                  a: AttackAnalysis) -> tuple[list[dict], list[AIStep]]:
    """Every hop must be an existing, allowed edge whose endpoints match and whose source is
    reachable. Duplicate hops across paths are checked once. Invalid hops are dropped."""
    edges = {e.edge_id: e for e in d.edges}
    can_start = set(reached) | {entry}
    checks: list[dict] = []
    kept: list[AIStep] = []
    seen: set[str] = set()
    for path in a.paths:
        for s in path.steps:
            if s.evidence_edge in seen:
                continue
            seen.add(s.evidence_edge)
            e = edges.get(s.evidence_edge)
            if e is None:
                reason = "edge does not exist in the input"
            elif not e.allowed:
                reason = "edge exists but allowed = false"
            elif (e.source, e.destination) != (s.from_, s.to):
                reason = f"{e.edge_id} connects {e.source} → {e.destination}, not {s.from_} → {s.to}"
            elif s.from_ not in can_start:
                reason = f"{s.from_} is not reachable from {entry}"
            else:
                reason = None
            checks.append({"edge_id": s.evidence_edge, "route": f"{s.from_} → {s.to}",
                           "ok": reason is None, "reason": reason or "allowed edge, endpoints match"})
            if reason is None:
                kept.append(s)
    return checks, kept


def reasoning_verdicts(d: ScenarioInput, entry: str, reached: list[str], verdict: dict,
                       a: AttackAnalysis, on_path: set[str] | None = None) -> list[dict]:
    """§4.4: accepted / corrected / rejected, by fixed rules.

    `on_path` = endpoints of the validated hops. A lateral step only counts as claiming loss on
    a node with no limit when that node is off the validated path.
    """
    nodes = {n.id: n for n in d.nodes}
    edges = {e.edge_id: e for e in d.edges}
    reach_set = set(reached) | {entry}
    on_path = on_path or {entry}
    out = []
    for i, r in enumerate(a.reasoning, 1):
        bad_edge = next((e for e in r.refs.edges if e not in edges or not edges[e].allowed), None)
        bad_node = next((n for n in r.refs.nodes if n not in nodes), None)
        unreachable = next((n for n in r.refs.nodes if n in nodes and n not in reach_set), None)
        no_limit = next((n for n in r.refs.nodes if n in nodes and nodes[n].transaction_limit_usd is None
                         and n not in on_path), None)
        # Nodes a step is about: its node refs, else the destinations of its edge refs.
        about = r.refs.nodes or [edges[e].destination for e in r.refs.edges if e in edges]
        if bad_edge:
            v, check = "rejected", (f"Validator: {bad_edge} does not exist." if bad_edge not in edges
                                    else f"Validator: {bad_edge} is allowed = false, never traversed.")
        elif bad_node:
            v, check = "rejected", f"Validator: {bad_node} is not a node in the input."
        elif unreachable:
            v, check = "rejected", f"BFS: {unreachable} is not reachable from {entry}."
        elif r.kind == "lateral" and no_limit:
            v, check = "rejected", (f"{no_limit} has no transaction_limit_usd: recorded as reached, "
                                    "not as loss.")
        elif r.kind == "detection_estimate":
            known = [nodes[n] for n in about if n in nodes and nodes[n].mttd_hours is not None]
            if known:
                cfg = ", ".join(f"{n.id} {n.mttd_hours:g}h" + (f" ({n.mttd_evidence})" if n.mttd_evidence else "")
                                for n in known)
                v, check = "corrected", (f"Engine overrides with config MTTD: {cfg}. "
                                         "Model estimates never enter the formula.")
            else:
                used = [p for p in verdict["per_system"] if p["mttd_h"] is not None]
                if used:
                    cfg = ", ".join(f"{p['node_id']} {p['mttd_h']:g}h" for p in used)
                    check = (f"Engine ignores this estimate: detection gaps come only from config MTTD "
                             f"on financial systems ({cfg}).")
                else:
                    check = "No config MTTD: the engine uses 1.0 and marks it UNKNOWN."
                v = "corrected"
        elif r.kind == "loss_estimate":
            v, check = "corrected", (f"Engine computes {usd(verdict['financial_exposure_usd'])} from "
                                     "limit × detection_gap × path_bypass. AI figure shown for comparison only.")
        elif r.kind == "branch" and r.refs.nodes:
            v, check = "accepted", f"BFS cross-check: {{{', '.join(r.refs.nodes)}}} ⊆ reachable set."
        elif r.refs.edges:
            v, check = "accepted", "Validator: " + ", ".join(f"{e} exists, allowed = true" for e in r.refs.edges) + "."
        else:
            v, check = "accepted", "Validator: every referenced node exists and is reachable."
        out.append({"n": i, "kind": r.kind, "title": r.title, "thought": r.thought,
                    "estimate": r.estimate, "verdict": v, "check": check})
    return out


def phases_out(d: ScenarioInput, verdict: dict, a: AttackAnalysis) -> list[dict]:
    """Model phases; impact phases get end_h overwritten by the target's config MTTD."""
    edges = {e.edge_id: e for e in d.edges}
    by_edge: dict[str, dict] = {}
    for p in verdict["per_system"]:
        for eid in p["chain"]:
            by_edge.setdefault(eid, p)
    out = []
    for ph in a.phases:
        if ph.edge_id is not None and (ph.edge_id not in edges or not edges[ph.edge_id].allowed):
            continue  # a phase on a fabricated or denied edge is dropped
        impact = ph.tactic_id == "TA0040"
        sys = by_edge.get(ph.edge_id) if impact and ph.edge_id else None
        end, end_source = ph.end_h, "model"
        if sys is not None:
            if sys["mttd_h"] is not None:
                end, end_source = sys["mttd_h"], "config_mttd"
            else:
                end_source = "model (no config MTTD)"
        out.append({
            "phase": ph.phase, "tactic_id": ph.tactic_id, "edge_id": ph.edge_id,
            "start_h": ph.start_h, "end_h": max(end, ph.start_h), "end_source": end_source,
            "impact": impact, "system": sys["node_id"] if sys else None,
            "accrues_usd": sys["exposure"] if sys else 0, "detail": ph.detail,
        })
    return out


def hops_out(d: ScenarioInput, steps: list[AIStep] | None, verdict: dict) -> list[dict]:
    """Hops with techniques. With no model output, the engine's best-path edges are listed
    with techniques marked as not named."""
    edges = {e.edge_id: e for e in d.edges}
    if steps is None:
        ids: list[str] = []
        for p in verdict["per_system"]:
            ids += [eid for eid in p["chain"] if eid not in ids]
        rows = [(eid, ENGINE_ONLY_TECHNIQUE, None, None) for eid in ids]
    else:
        rows = [(s.evidence_edge, s.technique, s.mitre_id, s.rationale) for s in steps]
    out = []
    for n, (eid, tech, mitre, why) in enumerate(rows, 1):
        e = edges[eid]
        out.append({
            "n": n, "edge_id": eid, "from": e.source, "to": e.destination,
            "route": f"{e.source} → {e.destination}", "permission": e.permission,
            "bypass": e.control_bypass_probability, "technique": tech, "mitre_id": mitre,
            "rationale": why, "evidence": e.evidence, "verified": True,
        })
    return out


def best_change(what_ifs: list[dict]) -> dict | None:
    cuts = [w for w in what_ifs if w["avoided_usd"] > 0]
    if not cuts:
        return None
    return max(cuts, key=lambda w: (w["per_hour_usd"] or 0, w["avoided_usd"]))


ENGINE_NARRATIVE = (
    "From the entry point, an attacker reaches the payment estate in {hops} over allowed "
    "edges. The engine puts up to {exposure} within reach before detection and {disruption} "
    "of disruption at risk. Techniques and reasoning were not generated because the AI "
    "step was unavailable."
)


def fill_narrative(template: str, hops: int, verdict: dict, what_ifs: list[dict]) -> str:
    """TR-10: numbers come only from placeholders; any other money figure is stripped."""
    if "{exposure}" not in template:
        template = ENGINE_NARRATIVE
    text = _MONEY.sub("", template)
    top = verdict["per_system"][0] if verdict["per_system"] else None
    best = best_change(what_ifs)
    # Each placeholder is a whole noun phrase, unit included, so the model cannot drop the unit.
    values = {
        "{hops}": f"{_num_word(hops)} hop{'s' if hops != 1 else ''}",
        "{mttd}": f"{top['mttd_h']:g} hours" if top and top["mttd_h"] is not None else "an unknown time",
        "{exposure}": usd(verdict["financial_exposure_usd"]),
        "{disruption}": f"{verdict['disruption_hours']:g} hours",
        "{avoided}": usd(best["avoided_usd"]) if best else "none of it",
    }
    for k, v in values.items():
        text = text.replace(k, v)
    return re.sub(r"\s{2,}", " ", text).strip()
