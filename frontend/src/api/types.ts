// Client types for the /v1 API (docs/TRD_V2.md §5). snake_case, as sent by the server.

export type CyberRisk = 'HIGH' | 'MEDIUM' | 'LOW'
export type RegulatoryStatus = 'MATERIAL' | 'BELOW'
export type RunSource = 'live' | 'cached' | 'engine_only'
export type Fallback = 'cached' | 'engine_only' | null

export interface Issue {
  path: string
  msg: string
}

export interface InputNode {
  id: string
  name?: string
  type: string
  criticality: string
  critical_function?: boolean
  transaction_limit_usd?: number
  mttd_hours?: number
  mttd_evidence?: string
  entry?: boolean
  x?: number
  y?: number
}

export interface InputEdge {
  edge_id: string
  source: string
  destination: string
  permission: string
  allowed: boolean
  control_bypass_probability?: number
  evidence?: string
}

export interface PerSystem {
  node_id: string
  criticality: string
  critical_function: boolean
  limit: number
  mttd_h: number | null
  gap: number
  gap_unknown: boolean
  bypass: number
  bypass_unknown: boolean
  chain: string[]
  chain_probs: number[]
  route: string[]
  exposure: number
  over_threshold: boolean
  disruption_h: number
}

export interface VerdictSummary {
  cyber_risk: CyberRisk
  financial_exposure_usd: number
  disruption_hours: number
  regulatory_status: RegulatoryStatus
  complete: boolean
}

export interface EvidenceRow {
  factor: string
  value: string
  source: string
  rule_id: string
  unknown: boolean
}

export interface Hop {
  n: number
  edge_id: string
  from: string
  to: string
  route: string
  permission: string
  bypass: number | null
  technique: string
  mitre_id: string | null
  rationale: string | null
  evidence: string | null
  verified: boolean
}

export interface HopCheck {
  edge_id: string
  route: string
  ok: boolean
  reason: string
}

export interface Phase {
  phase: string
  tactic_id: string
  edge_id: string | null
  start_h: number
  end_h: number
  end_source: string
  impact: boolean
  system: string | null
  accrues_usd: number
  detail: string
}

export type ReasoningVerdict = 'accepted' | 'corrected' | 'rejected'

export interface ReasoningStep {
  n: number
  kind: string
  title: string
  thought: string
  estimate: number | null
  verdict: ReasoningVerdict
  check: string
}

export interface WhatIf {
  id: string
  label: string
  op: 'remove_edge' | 'clear_evidence'
  target: string
  field: string | null
  note: string
  effort_hours: number
  after: VerdictSummary
  avoided_usd: number
  per_hour_usd: number | null
  removed_edges: string[]
  cleared: { target: string; field: string }[]
}

export interface AnalysisResult {
  run_id: string
  source: RunSource
  model: string | null
  fallback: Fallback
  scenario_id: string
  scenario_label: string
  entry: string
  verdict: VerdictSummary & { threshold_usd: number }
  per_system: PerSystem[]
  reached: string[]
  evidence: EvidenceRow[]
  hops: Hop[]
  path_edges: string[]
  on_path: string[]
  validation: { hops: HopCheck[]; bfs_subset: boolean; extra: string[] }
  phases: Phase[]
  reasoning: ReasoningStep[]
  mttd_estimates: { node_id: string; hours: number }[]
  ai_estimate: { low: number; high: number; delta_pct_vs_engine: number | null } | null
  narrative: string
  what_ifs: WhatIf[]
  rules: { disruption_hours: Record<string, number>; materiality_threshold_usd: number }
  graph: { nodes: InputNode[]; edges: InputEdge[] }
  ms: number
}

// Stream events (one SSE frame each).
export interface StageEvent {
  id: string
  label: string
  status: 'running' | 'done' | 'failed'
  meta: string
  ms: number | null
}

export interface InputsEvent {
  priority: PerSystem[]
  supporting: { label: string; note: string; value: string }[]
  not_used: { label: string; note: string }[]
}

export interface AiInputEvent {
  model: string
  temperature: number
  prompt_redactions: string[]
  payload: unknown
}

export interface ValidationEvent {
  hops: HopCheck[]
  bfs_subset: boolean
  extra: string[]
  reasoning_verdicts: Record<ReasoningVerdict, number>
}

export interface ErrorEvent {
  stage: string
  message: string
  fallback: Fallback
}

export type RunEvent =
  | { event: 'stage'; data: StageEvent }
  | { event: 'inputs'; data: InputsEvent }
  | { event: 'ai_input'; data: AiInputEvent }
  | { event: 'ai_output'; data: unknown }
  | { event: 'validation'; data: ValidationEvent }
  | { event: 'error'; data: ErrorEvent }
  | { event: 'result'; data: AnalysisResult }
