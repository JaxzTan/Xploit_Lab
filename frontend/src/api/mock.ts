// Dev-only mock of the FAPI backend (enabled with VITE_MOCK=1).
// Scenario data is lifted from the design guide; the engine below is a port of the
// design guide's compute()/applyChanges() so the mock returns contract-shaped,
// realistic numbers. The real app never runs this: in production every number
// comes from the backend.
import type { FapiApi } from './client'
import { ApiError } from './client'
import type {
  AnalyzeResponse,
  Change,
  EvidenceRow,
  GraphEdge,
  GraphNode,
  HopDetail,
  Phase,
  PerSystem,
  ReasoningStep,
  Rules,
  Scenario,
  Verdict,
  WhatIfResponse,
} from './types'
import raw from './mockData.json'

interface MockAi {
  path_edge_ids: string[]
  on_path: string[]
  techniques: Record<string, string>
  hop_details: Record<string, HopDetail>
  phases: Phase[]
  reasoning: ReasoningStep[]
  ai_estimate: { low: number; high: number }
  narrative_template: string
  hops_word?: string
  mttd_phrase?: string
}

interface MockEntry {
  scenario: Omit<Scenario, 'source'>
  ai: MockAi
}

const DATA = raw as unknown as Record<string, MockEntry>
const ORDER = ['meridian', 'hydra', 'lion']
const SOURCE = 'live' as const

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

function entry(id: string): MockEntry {
  const e = DATA[id]
  if (!e) throw new ApiError(404, `404 unknown scenario_id '${id}'`)
  return e
}

type Adj = Record<string, GraphEdge[]>

function bfs(edges: GraphEdge[], start: string) {
  const adj: Adj = {}
  edges.filter((e) => e.allowed).forEach((e) => (adj[e.source] = adj[e.source] || []).push(e))
  const reached = new Set<string>()
  const q = [start]
  while (q.length) {
    const n = q.shift() as string
    ;(adj[n] || []).forEach((e) => {
      if (!reached.has(e.destination)) {
        reached.add(e.destination)
        q.push(e.destination)
      }
    })
  }
  return { reached, adj }
}

function bestBypass(adj: Adj, start: string, target: string) {
  let best = 0
  let unknown = false
  let chain: string[] = []
  const walk = (n: string, prod: number, seen: Set<string>, ids: string[], sawUnknown: boolean) => {
    if (n === target) {
      if (prod > best) {
        best = prod
        unknown = sawUnknown
        chain = ids.slice()
      }
      return
    }
    ;(adj[n] || []).forEach((e) => {
      if (seen.has(e.destination)) return
      const hasP = e.control_multiplier !== null && e.control_multiplier !== undefined
      const next = new Set(seen)
      next.add(e.destination)
      walk(e.destination, prod * (hasP ? (e.control_multiplier as number) : 1), next, ids.concat(e.edge_id), sawUnknown || !hasP)
    })
  }
  walk(start, 1, new Set([start]), [], false)
  return { value: best, unknown, chain }
}

function compute(nodes: GraphNode[], edges: GraphEdge[], rules: Rules, start: string): Verdict {
  const byId: Record<string, GraphNode> = {}
  nodes.forEach((n) => (byId[n.id] = n))
  const { reached, adj } = bfs(edges, start)
  const perSystem: PerSystem[] = []
  const evidence: EvidenceRow[] = []
  let total = 0
  let complete = true
  let criticalFinancialCount = 0
  nodes.forEach((n) => {
    if (!reached.has(n.id) || n.type !== 'financial' || n.exposed_capacity_24h_usd == null) return
    const gapUnknown = n.detection_delay_hours == null
    const gap = gapUnknown ? 1 : Math.min((n.detection_delay_hours as number) / 24, 1)
    const bp = bestBypass(adj, start, n.id)
    if (gapUnknown || bp.unknown) complete = false
    const exposure = Math.round(n.exposed_capacity_24h_usd * gap * bp.value)
    total += exposure
    if (n.criticality === 'critical' && n.critical_function) criticalFinancialCount += 1
    perSystem.push({
      node_id: n.id,
      exposed_capacity_24h_usd: n.exposed_capacity_24h_usd,
      detection_delay_hours: gapUnknown ? null : (n.detection_delay_hours as number),
      detection_window_factor: gap,
      gap_unknown: gapUnknown,
      control_multiplier: bp.value,
      chain: bp.chain,
      bypass_unknown: bp.unknown,
      exposure_usd: exposure,
    })
    evidence.push(
      { factor: 'exposed_capacity_24h · ' + n.name, value: usd(n.exposed_capacity_24h_usd), source: 'node:' + n.id, rule_id: 'R-EXP-1', unknown: false },
      {
        factor: 'detection_window_factor · ' + n.name,
        value: gapUnknown ? 'UNKNOWN → 1.00' : gap.toFixed(2),
        source: gapUnknown ? 'node:' + n.id + ' · no detection_delay_evidence on record' : 'node:' + n.id + (n.detection_delay_evidence ? ' · ' + n.detection_delay_evidence : ''),
        rule_id: gapUnknown ? 'R-UNK-1' : 'R-WIN-1',
        unknown: gapUnknown,
      },
      { factor: 'control_multiplier · ' + n.name, value: bp.value.toFixed(2), source: 'edge:' + bp.chain.join(' × edge:'), rule_id: 'R-BYP-1', unknown: bp.unknown },
    )
  })
  let disruption = 0
  let anyCritical = false
  let anyHigh = false
  let unauthorizedCriticalPayment = false
  const table = rules.disruption as unknown as Record<string, number | undefined>
  reached.forEach((id) => {
    const n = byId[id]
    disruption = Math.max(disruption, table[n.criticality] || 0)
    if (n.criticality === 'critical') anyCritical = true
    if (n.criticality === 'high') anyHigh = true
    if (n.critical_function && n.type === 'financial') unauthorizedCriticalPayment = true
  })
  if (criticalFinancialCount >= 2) disruption = Math.max(disruption, rules.disruption.multi_critical || 96)
  else if (criticalFinancialCount === 1) disruption = Math.max(disruption, rules.disruption.critical || 72)
  const cyber = anyCritical ? 'HIGH' : anyHigh ? 'MEDIUM' : 'LOW'
  const regulatory = unauthorizedCriticalPayment ? 'MAJOR' : 'BELOW'
  evidence.push(
    {
      factor: 'disruption_hours',
      value: disruption + 'h',
      source:
        criticalFinancialCount >= 2
          ? 'rules.json → 2+ critical financial systems ⇒ ' + disruption + 'h (recovery-policy)'
          : 'rules.json → ' + criticalFinancialCount + ' critical financial system ⇒ ' + disruption + 'h',
      rule_id: 'R-DIS-1',
      unknown: false,
    },
    { factor: 'cyber_risk', value: cyber, source: 'rules.json → highest criticality among reached nodes', rule_id: 'R-CYB-1', unknown: false },
    {
      factor: 'dora_classification',
      value: regulatory === 'MAJOR' ? 'Major ICT-related incident (simulated)' : 'Below classification',
      source: 'rules.json → EU-covered entity ∧ unauthorized access to a critical payment service',
      rule_id: 'R-REG-1',
      unknown: false,
    },
  )
  return {
    cyber_risk: cyber,
    financial_exposure_usd: total,
    disruption_hours: disruption,
    regulatory_status: regulatory,
    complete,
    critical_financial_count: criticalFinancialCount,
    reached: Array.from(reached),
    per_system: perSystem,
    evidence,
  }
}

function applyChanges(sc: MockEntry['scenario'], list: Change[]) {
  const nodes = sc.nodes.map((n) => ({ ...n })) as GraphNode[]
  let edges = sc.edges.map((e) => ({ ...e }))
  list.forEach((c) => {
    if (c.op === 'remove_edge') edges = edges.filter((e) => e.edge_id !== c.target)
    if (c.op === 'clear_evidence')
      nodes.forEach((n) => {
        if (n.id === c.target && c.field) (n as unknown as Record<string, unknown>)[c.field] = null
      })
  })
  return { nodes, edges }
}

export const mockApi: FapiApi = {
  async listScenarios() {
    await delay(60)
    return ORDER.map((id) => ({ id, name: DATA[id].scenario.meta.name, label: DATA[id].scenario.meta.label }))
  },

  async getScenario(id) {
    await delay(80)
    return { ...clone(entry(id).scenario), source: SOURCE }
  },

  async analyze(scenarioId): Promise<AnalyzeResponse> {
    const { scenario: sc, ai } = entry(scenarioId)
    await delay(1600)
    const verdict = compute(sc.nodes, sc.edges, sc.rules, sc.entry)
    const edgeById = Object.fromEntries(sc.edges.map((e) => [e.edge_id, e]))
    const steps = ai.path_edge_ids.map((id) => ({
      from: edgeById[id].source,
      to: edgeById[id].destination,
      technique: ai.techniques[id] ?? '',
      evidence_edge: id,
    }))
    // {avoided} in the narrative is the value of the scenario's first (headline) fix.
    const first = sc.changes.find((c) => c.op === 'remove_edge')
    const fixed = first ? applyChanges(sc, [first]) : null
    const after = fixed ? compute(fixed.nodes, fixed.edges, sc.rules, sc.entry) : verdict
    const narrative = ai.narrative_template
      .replace('{hops}', ai.hops_word ?? String(steps.length))
      .replace('{mttd}', ai.mttd_phrase ?? 'the configured detection delay')
      .replace('{exposure}', usd(verdict.financial_exposure_usd))
      .replace('{disruption}', String(verdict.disruption_hours))
      .replace('{avoided}', usd(verdict.financial_exposure_usd - after.financial_exposure_usd))
    return {
      scenario_id: scenarioId,
      source: SOURCE,
      fallback_reason: null,
      path: {
        entry_point: sc.entry,
        steps,
        systems_reached: verdict.reached,
        path_edge_ids: ai.path_edge_ids,
        on_path: ai.on_path,
      },
      validation: { hops_verified: steps.length, hops_total: steps.length, bfs_subset: true, rejected_hops: [] },
      techniques: ai.techniques,
      hop_details: ai.hop_details,
      phases: ai.phases,
      reasoning: ai.reasoning,
      ai_estimate: ai.ai_estimate,
      narrative,
      narrative_template: ai.narrative_template,
      verdict,
    }
  },

  async whatIf(scenarioId, changeIds): Promise<WhatIfResponse> {
    const { scenario: sc } = entry(scenarioId)
    await delay(120)
    const list = changeIds.map((id) => {
      const c = sc.changes.find((x) => x.id === id)
      if (!c) throw new ApiError(422, `422 unknown change_id '${id}'`)
      return c
    })
    const before = compute(sc.nodes, sc.edges, sc.rules, sc.entry)
    const m = applyChanges(sc, list)
    const after = compute(m.nodes, m.edges, sc.rules, sc.entry)
    return {
      before,
      after,
      avoided_usd: before.financial_exposure_usd - after.financial_exposure_usd,
      effort_hours: list.reduce((s, c) => s + (c.effort || 0), 0),
      removed_edges: list.filter((c) => c.op === 'remove_edge').map((c) => c.target),
      cleared_evidence: list.filter((c) => c.op === 'clear_evidence').map((c) => ({ node_id: c.target, field: c.field ?? '' })),
    }
  },
}
