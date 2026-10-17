"""v1 input model (`ScenarioInput`, TRD_V2 §4.1) and the schema + graph lint behind /v1/validate.

The JSON body is the "database" for this stage. Rules and field names follow TRD_V2; the
console design's spellings (`scenario`, `disruption_hours_by_criticality`,
`regulatory_threshold_usd`) are accepted as aliases.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, PrivateAttr, ValidationError

MAX_BODY_BYTES = 64 * 1024
MAX_NODES = 50
MAX_EDGES = 150
TEXT = 500  # every free-text field

NodeType = Literal["external", "identity", "build", "financial", "data", "process", "service"]
Criticality = Literal["critical", "high", "medium", "low"]

DEFAULT_DISRUPTION = {"critical": 72, "high": 24, "medium": 8, "low": 0}
DEFAULT_THRESHOLD = 100_000


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class NodeIn(_Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str | None = Field(None, max_length=100)
    type: NodeType
    criticality: Criticality
    critical_function: bool = False
    transaction_limit_usd: float | None = Field(None, ge=0)
    mttd_hours: float | None = Field(None, ge=0)
    mttd_evidence: str | None = Field(None, max_length=TEXT)
    entry: bool | None = None
    x: float | None = None
    y: float | None = None


class EdgeIn(_Strict):
    edge_id: str = Field(min_length=1, max_length=100)
    source: str
    destination: str
    permission: str = Field("", max_length=100)
    allowed: bool
    control_bypass_probability: float | None = Field(None, ge=0, le=1)
    evidence: str | None = Field(None, max_length=TEXT)


class DisruptionHours(_Strict):
    critical: float = DEFAULT_DISRUPTION["critical"]
    high: float = DEFAULT_DISRUPTION["high"]
    medium: float = DEFAULT_DISRUPTION["medium"]
    low: float = DEFAULT_DISRUPTION["low"]


class RulesIn(_Strict):
    disruption_hours: DisruptionHours = Field(
        default_factory=DisruptionHours,
        validation_alias=AliasChoices("disruption_hours", "disruption_hours_by_criticality"),
    )
    materiality_threshold_usd: float = Field(
        DEFAULT_THRESHOLD, ge=0,
        validation_alias=AliasChoices("materiality_threshold_usd", "regulatory_threshold_usd"),
    )


class WhatIfIn(_Strict):
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(max_length=120)
    op: Literal["remove_edge", "clear_evidence"]
    target: str
    field: Literal["mttd_hours", "control_bypass_probability", "transaction_limit_usd"] | None = None
    effort_hours: float = Field(0, ge=0)
    note: str = Field("", max_length=TEXT)


class ScenarioInput(_Strict):
    scenario_id: str = Field(
        "untitled", max_length=100, validation_alias=AliasChoices("scenario_id", "scenario"),
    )
    entry: str | None = None
    nodes: list[NodeIn] = Field(max_length=MAX_NODES)
    edges: list[EdgeIn] = Field(max_length=MAX_EDGES)
    rules: RulesIn = Field(default_factory=RulesIn)
    what_ifs: list[WhatIfIn] | None = None
    _rules_given: bool = PrivateAttr(False)

    @property
    def rules_given(self) -> bool:
        return self._rules_given


@dataclass
class Issue:
    path: str
    msg: str

    def as_dict(self) -> dict:
        return {"path": self.path, "msg": self.msg}


@dataclass
class LintResult:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    data: ScenarioInput | None = None
    entry: str | None = None

    @property
    def ok(self) -> bool:
        return not self.errors and self.data is not None and self.entry is not None

    def stats(self) -> dict:
        d = self.data
        if d is None:
            return {}
        return {
            "nodes": len(d.nodes),
            "edges": len(d.edges),
            "financial": sum(n.type == "financial" for n in d.nodes),
            "blocked_edges": sum(not e.allowed for e in d.edges),
            "entry": self.entry,
            "rules": "input" if d.rules_given else "defaults",
        }

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": [i.as_dict() for i in self.errors],
            "warnings": [i.as_dict() for i in self.warnings],
            "stats": self.stats(),
        }


def _path(loc: tuple) -> str:
    out = "$"
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out


def resolve_entry(d: ScenarioInput) -> str | None:
    """`entry` → node with `entry: true` → first external node with an allowed outgoing edge."""
    if d.entry:
        return d.entry
    flagged = next((n.id for n in d.nodes if n.entry), None)
    if flagged:
        return flagged
    sources = {e.source for e in d.edges if e.allowed}
    return next((n.id for n in d.nodes if n.type == "external" and n.id in sources), None)


def lint(raw: Any) -> LintResult:
    res = LintResult()
    if not isinstance(raw, dict):
        res.errors.append(Issue("$", "top level must be a JSON object"))
        return res
    try:
        d = ScenarioInput.model_validate(raw)
    except ValidationError as exc:
        for err in exc.errors():
            res.errors.append(Issue(_path(err["loc"]), err["msg"]))
        return res
    d._rules_given = "rules" in raw
    res.data = d

    node_ids: dict[str, int] = {}
    for i, n in enumerate(d.nodes):
        if n.id in node_ids:
            res.errors.append(Issue(f"$.nodes[{i}].id", f"duplicate node id {n.id!r}"))
        node_ids.setdefault(n.id, i)
    edge_ids: dict[str, int] = {}
    for i, e in enumerate(d.edges):
        if e.edge_id in edge_ids:
            res.errors.append(Issue(f"$.edges[{i}].edge_id", f"duplicate edge id {e.edge_id!r}"))
        edge_ids.setdefault(e.edge_id, i)
        for end in ("source", "destination"):
            ref = getattr(e, end)
            if ref not in node_ids:
                res.errors.append(Issue(f"$.edges[{i}].{end}", f"{e.edge_id} points to unknown node {ref!r}"))

    entry = resolve_entry(d)
    if entry is None:
        res.errors.append(Issue("$.entry", 'no entry point: set "entry" or mark a node "entry": true'))
    elif entry not in node_ids:
        res.errors.append(Issue("$.entry", f"entry {entry!r} is not a node"))
    else:
        res.entry = entry

    for i, w in enumerate(d.what_ifs or []):
        if w.op == "remove_edge" and w.target not in edge_ids:
            res.errors.append(Issue(f"$.what_ifs[{i}].target", f"unknown edge {w.target!r}"))
        if w.op == "clear_evidence":
            if w.target not in node_ids and w.target not in edge_ids:
                res.errors.append(Issue(f"$.what_ifs[{i}].target", f"unknown node or edge {w.target!r}"))
            if w.field is None:
                res.errors.append(Issue(f"$.what_ifs[{i}].field", "clear_evidence needs a field"))

    # Warnings: factors that will be UNKNOWN or zero.
    for i, n in enumerate(d.nodes):
        if n.type != "financial":
            continue
        if n.transaction_limit_usd is None:
            res.warnings.append(Issue(f"$.nodes[{i}]", f"{n.id}: no transaction_limit_usd, exposure $0"))
        elif n.mttd_hours is None:
            res.warnings.append(Issue(f"$.nodes[{i}].mttd_hours", f"{n.id}: MTTD missing, UNKNOWN → 1.0"))
    for i, e in enumerate(d.edges):
        if e.allowed and e.control_bypass_probability is None:
            res.warnings.append(Issue(f"$.edges[{i}].control_bypass_probability",
                                      f"{e.edge_id}: bypass probability missing, UNKNOWN → 1.0"))
    if res.errors:
        res.entry = None
    return res


def canonical_hash(d: ScenarioInput) -> str:
    """sha256 of the parsed input, so whitespace, key order and alias spelling don't matter."""
    body = d.model_dump(mode="json", exclude_none=True)
    blob = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()
