import type { InputEdge, InputNode } from '../api/types'

export type CheckLevel = 'ok' | 'warn' | 'err'

export interface Check {
  level: CheckLevel
  label: string
  detail: string
}

export interface Inspection {
  checks: Check[]
  data: { nodes: InputNode[]; edges: InputEdge[]; entry?: string; rules?: unknown } | null
  entry: string | null
  valid: boolean
}

/** Same resolution order as the server: entry → node.entry → first external with an allowed out-edge. */
export function resolveEntry(nodes: InputNode[], edges: InputEdge[], entry?: string): string | undefined {
  if (entry) return entry
  const flagged = nodes.find((n) => n.entry)
  if (flagged) return flagged.id
  return nodes.find((n) => n.type === 'external' && edges.some((e) => e.allowed && e.source === n.id))?.id
}

/**
 * Instant client-side check of the composer text (design `inspect`). The server repeats the full
 * schema lint on Analyze and its {path, msg} errors replace these if it disagrees.
 */
export function inspect(text: string): Inspection {
  const checks: Check[] = []
  const ok = (label: string, detail: string) => checks.push({ level: 'ok', label, detail })
  const warn = (label: string, detail: string) => checks.push({ level: 'warn', label, detail })
  const err = (label: string, detail: string) => checks.push({ level: 'err', label, detail })

  if (!text.trim()) {
    err('Waiting for input', 'Type or paste JSON, upload a file or load the sample.')
    return { checks, data: null, entry: null, valid: false }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    err('Invalid JSON', e instanceof Error ? e.message : String(e))
    return { checks, data: null, entry: null, valid: false }
  }
  const obj = raw as Record<string, unknown> | null
  const nodes = obj && Array.isArray(obj.nodes) ? (obj.nodes as InputNode[]) : null
  const edges = obj && Array.isArray(obj.edges) ? (obj.edges as InputEdge[]) : null
  if (!nodes || !edges) {
    err('Missing nodes or edges', 'Top level needs "nodes": [] and "edges": [].')
    return { checks, data: null, entry: null, valid: false }
  }
  const data = obj as unknown as NonNullable<Inspection['data']>
  ok('Valid JSON', `${nodes.length} nodes · ${edges.length} edges`)

  const ids = new Set<string>()
  const dupes = new Set<string>()
  nodes.forEach((n) => (ids.has(n?.id) ? dupes.add(n.id) : ids.add(n?.id)))
  if (dupes.size) err('Duplicate node ids', [...dupes].join(', '))
  const bad = edges.filter((e) => !ids.has(e?.source) || !ids.has(e?.destination))
  if (bad.length) err('Broken references', `${bad.map((e) => e?.edge_id || '?').join(', ')} point to unknown nodes`)

  const entry = resolveEntry(nodes, edges, typeof obj!.entry === 'string' ? obj!.entry : undefined)
  if (entry && ids.has(entry)) ok('Entry point', entry)
  else err('No entry point', 'Set "entry" or mark a node "entry": true.')

  const financial = nodes.filter((n) => n?.type === 'financial')
  const withLimit = financial.filter((n) => n.transaction_limit_usd != null)
  if (withLimit.length) ok('Financial systems', `${withLimit.length} with transaction limits`)
  else warn('No transaction limits', 'Exposure will be $0.')
  const noMttd = withLimit.filter((n) => n.mttd_hours == null)
  if (noMttd.length) warn('Missing MTTD', `${noMttd.map((n) => n.id).join(', ')} → UNKNOWN, treated as 1.0`)
  const noP = edges.filter((e) => e?.allowed && e.control_bypass_probability == null)
  if (noP.length) warn('Missing bypass probability', `${noP.map((e) => e.edge_id).join(', ')} → UNKNOWN, treated as 1.0`)
  ok('Rules', obj!.rules ? 'from input' : 'defaults (72 / 24 / 8h, $100,000)')

  const valid = !checks.some((c) => c.level === 'err')
  return { checks, data, entry: valid ? entry! : null, valid }
}
