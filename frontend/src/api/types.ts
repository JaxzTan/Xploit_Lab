// Client types for the FAPI API. Mirrors /API-CONTRACT.md exactly (snake_case JSON).

export type Criticality = 'critical' | 'high' | 'medium' | 'low'
export type CyberRisk = 'HIGH' | 'MEDIUM' | 'LOW'
export type RegulatoryStatus = 'MAJOR' | 'BELOW'
export type Source = 'live' | 'cached'
export type FallbackReason = null | 'timeout' | 'error' | 'validation_failed' | 'no_api_key' | 'demo_mode'

export interface ScenarioSummary {
  id: string
  name: string
  label: string
}

/** Per-scenario display strings. Known keys are typed; the server may add more. */
export interface ScenarioMeta {
  name: string
  headline_lead?: string
  headline_tail?: string
  entity?: string
  reg_primary?: string
  reg_secondary?: string
  label: string
  entry_label: string
  hops_word?: string
  idle_h1: string
  idle_intro: string
  cyber_note?: string
  exp_note?: string
  mttd_phrase?: string
  recovery_policy?: string
  stackable?: boolean
  [key: string]: unknown
}

export interface GraphNode {
  id: string
  name: string
  plain_name?: string
  type: string
  criticality: Criticality
  critical_function?: boolean
  exposed_capacity_24h_usd?: number | null
  detection_delay_hours?: number | null
  detection_delay_evidence?: string
  x: number
  y: number
  entry?: boolean
}

export interface GraphEdge {
  edge_id: string
  source: string
  destination: string
  permission: string
  allowed: boolean
  control_multiplier?: number | null
  evidence?: string
}

export interface Rules {
  disruption: { critical: number; high: number; medium: number; multi_critical?: number }
  threshold?: number
}

export interface Change {
  id: string
  label: string
  op: 'remove_edge' | 'clear_evidence'
  target: string
  field?: string
  effort: number
  cuts: string
  note: string
}

export interface Scenario {
  id: string
  meta: ScenarioMeta
  entry: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  rules: Rules
  changes: Change[]
  source: Source
}

export interface PerSystem {
  node_id: string
  exposed_capacity_24h_usd: number
  detection_delay_hours: number | null
  detection_window_factor: number
  gap_unknown: boolean
  control_multiplier: number
  chain: string[]
  bypass_unknown: boolean
  exposure_usd: number
}

export interface EvidenceRow {
  factor: string
  value: string
  source: string
  rule_id: string
  unknown: boolean
}

export interface Verdict {
  cyber_risk: CyberRisk
  financial_exposure_usd: number
  disruption_hours: number
  regulatory_status: RegulatoryStatus
  complete: boolean
  critical_financial_count: number
  reached: string[]
  per_system: PerSystem[]
  evidence: EvidenceRow[]
}

export interface PathStep {
  from: string
  to: string
  technique: string
  evidence_edge: string
}

export interface AttackPath {
  entry_point: string
  steps: PathStep[]
  systems_reached: string[]
  path_edge_ids: string[]
  on_path: string[]
}

export interface Validation {
  hops_verified: number
  hops_total: number
  bfs_subset: boolean
  rejected_hops: unknown[]
}

export interface HopRef {
  fw: string
  id: string
  lbl: string
}

export interface HopDetail {
  title: string
  how: string
  leverage: string
  refs?: HopRef[]
  determined?: string
  [key: string]: unknown
}

export interface Phase {
  phase: string
  tactic: string
  start: number
  end: number
  edge: string | null
  detail: string
  branch_exposure?: number
}

export type ReasoningVerdict = 'accepted' | 'corrected' | 'deferred' | 'rejected'

export interface ReasoningStep {
  title: string
  verdict: ReasoningVerdict | string
  thought: string
  check: string
}

export interface AnalyzeResponse {
  scenario_id: string
  source: Source
  fallback_reason: FallbackReason
  path: AttackPath
  validation: Validation
  techniques: Record<string, string>
  hop_details: Record<string, HopDetail>
  phases: Phase[]
  reasoning: ReasoningStep[]
  ai_estimate: { low: number; high: number }
  narrative: string
  narrative_template: string
  verdict: Verdict
}

export interface WhatIfResponse {
  before: Verdict
  after: Verdict
  avoided_usd: number
  effort_hours: number
  removed_edges: string[]
  cleared_evidence: { node_id: string; field: string }[]
}
