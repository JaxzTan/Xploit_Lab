"""Pydantic models: scenario data (bank.json / golden_path.json), Gemini schema, API I/O."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Criticality = Literal["critical", "high", "medium", "low"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- bank.json


class Node(_Strict):
    id: str
    name: str
    plain_name: str | None = None
    type: str
    criticality: Criticality
    critical_function: bool | None = None
    exposed_capacity_24h_usd: int | float | None = None
    detection_delay_hours: int | float | None = None
    detection_delay_evidence: str | None = None
    x: int | float
    y: int | float
    entry: bool | None = None


class Edge(_Strict):
    edge_id: str
    source: str
    destination: str
    permission: str
    allowed: bool
    control_multiplier: float | None = None
    evidence: str | None = None


class DisruptionRules(_Strict):
    critical: int | float
    high: int | float
    medium: int | float
    multi_critical: int | float | None = None


class Rules(_Strict):
    disruption: DisruptionRules
    threshold: int | float | None = None  # not present for lion in the design guide
    rule_ids: dict[str, str] = Field(default_factory=dict)


class Change(_Strict):
    id: str
    label: str
    op: Literal["remove_edge", "clear_evidence"]
    target: str
    field: str | None = None
    effort: int | float
    cuts: str
    note: str


class Scenario(_Strict):
    """bank.json — static, validated at startup (fail fast)."""

    id: str
    meta: dict[str, Any]
    entry: str
    nodes: list[Node]
    edges: list[Edge]
    rules: Rules
    changes: list[Change]

    @model_validator(mode="after")
    def _check_refs(self) -> Scenario:
        ids = [n.id for n in self.nodes]
        if len(set(ids)) != len(ids):
            raise ValueError(f"{self.id}: duplicate node ids")
        node_ids = set(ids)
        if self.entry not in node_ids:
            raise ValueError(f"{self.id}: entry {self.entry!r} is not a node")
        edge_ids = [e.edge_id for e in self.edges]
        if len(set(edge_ids)) != len(edge_ids):
            raise ValueError(f"{self.id}: duplicate edge ids")
        for e in self.edges:
            if e.source not in node_ids or e.destination not in node_ids:
                raise ValueError(f"{self.id}: edge {e.edge_id} references unknown node")
        for c in self.changes:
            if c.op == "remove_edge" and c.target not in edge_ids:
                raise ValueError(f"{self.id}: change {c.id} targets unknown edge {c.target}")
            if c.op == "clear_evidence":
                if c.target not in node_ids:
                    raise ValueError(f"{self.id}: change {c.id} targets unknown node {c.target}")
                if c.field not in Node.model_fields:
                    raise ValueError(f"{self.id}: change {c.id} clears unknown field {c.field}")
        return self


# --------------------------------------------------------------------------- Gemini schema


class Step(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from", description="node id the hop starts at")
    to: str = Field(description="node id the hop reaches")
    technique: str = Field(description="attack technique name with MITRE ATT&CK id")
    evidence_edge: str = Field(description="edge_id of the allowed edge this hop uses")


class AttackPath(BaseModel):
    """Gemini response schema (response_schema=AttackPath)."""

    entry_point: str
    steps: list[Step]
    systems_reached: list[str]
    narrative: str = Field(
        description="board-level prose; must use the literal placeholders {exposure} and "
        "{disruption} instead of any numbers"
    )


# --------------------------------------------------------------------------- golden_path.json


class GoldenPath(_Strict):
    entry_point: str
    steps: list[Step]
    systems_reached: list[str]
    path_edge_ids: list[str]
    on_path: list[str]
    techniques: dict[str, str]
    hop_details: dict[str, dict[str, Any]]
    phases: list[dict[str, Any]]
    reasoning: list[dict[str, Any]]
    ai_estimate: dict[str, int | float]
    narrative_template: str


# --------------------------------------------------------------------------- engine output


class PerSystem(BaseModel):
    node_id: str
    exposed_capacity_24h_usd: int | float
    detection_delay_hours: int | float | None
    detection_window_factor: float
    gap_unknown: bool
    control_multiplier: float
    chain: list[str]
    bypass_unknown: bool
    exposure_usd: int
    exposure_raw: float  # unrounded, for exact parity with the design JS


class EvidenceRow(BaseModel):
    factor: str
    value: str
    source: str
    rule_id: str
    unknown: bool = False
    note: str | None = None  # the design guide's human-readable source text


class Verdict(BaseModel):
    cyber_risk: Literal["HIGH", "MEDIUM", "LOW"]
    financial_exposure_usd: int
    financial_exposure_raw: float
    disruption_hours: int | float
    regulatory_status: Literal["MAJOR", "BELOW"]
    complete: bool
    critical_financial_count: int
    reached: list[str]
    per_system: list[PerSystem]
    evidence: list[EvidenceRow]


# --------------------------------------------------------------------------- API I/O


class AnalyzeRequest(BaseModel):
    scenario_id: str


class WhatIfRequest(BaseModel):
    scenario_id: str
    change_ids: list[str] = Field(default_factory=list)


class StepOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_: str = Field(alias="from")
    to: str
    technique: str
    evidence_edge: str


class PathOut(BaseModel):
    entry_point: str
    steps: list[StepOut]
    systems_reached: list[str]
    path_edge_ids: list[str]
    on_path: list[str]


class RejectedHop(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_: str = Field(alias="from")
    to: str
    evidence_edge: str
    reason: str


class Validation(BaseModel):
    hops_verified: int
    hops_total: int
    bfs_subset: bool
    rejected_hops: list[RejectedHop]


class AnalyzeResponse(BaseModel):
    scenario_id: str
    source: Literal["live", "cached"]
    fallback_reason: (
        Literal["timeout", "error", "validation_failed", "no_api_key", "demo_mode"] | None
    )
    path: PathOut
    validation: Validation
    techniques: dict[str, str]
    hop_details: dict[str, dict[str, Any]]
    phases: list[dict[str, Any]]
    reasoning: list[dict[str, Any]]
    ai_estimate: dict[str, int | float]
    narrative: str
    narrative_template: str
    verdict: Verdict


class ClearedEvidence(BaseModel):
    node_id: str
    field: str


class WhatIfResponse(BaseModel):
    before: Verdict
    after: Verdict
    avoided_usd: int
    effort_hours: int | float
    removed_edges: list[str]
    cleared_evidence: list[ClearedEvidence]
