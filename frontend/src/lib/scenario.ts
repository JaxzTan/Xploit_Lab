import type { GraphNode, Scenario, Verdict } from '../api/types'
import { usd } from './format'

/** Board-facing name: plain name when present, else the technical id. */
export const displayName = (n: GraphNode | undefined, fallback = ''): string =>
  n ? (n.plain_name ? n.plain_name : n.name) : fallback

export function nodeIndex(sc: Scenario): Record<string, GraphNode> {
  const byId: Record<string, GraphNode> = {}
  sc.nodes.forEach((n) => (byId[n.id] = n))
  return byId
}

/** Exposure figure as the UI must show it: an upper bound when evidence is missing (FR-6). */
export const exposureText = (v: Verdict): string => (v.complete ? '' : 'up to ') + usd(v.financial_exposure_usd)

export const verdictRows = (v: Verdict) => [
  { k: 'Cyber risk', v: v.cyber_risk },
  { k: 'Financial exposure', v: exposureText(v) },
  { k: 'Disruption', v: v.disruption_hours + ' hours' },
  { k: 'Regulatory', v: v.regulatory_status + (v.complete ? '' : ' · INCOMPLETE') },
]

/** Fill a placeholder the server may have left in the narrative (defensive; the server substitutes). */
export function fillNarrative(text: string, sc: Scenario, v: Verdict): string {
  return text
    .replace('{hops}', sc.meta.hops_word ?? '')
    .replace('{mttd}', sc.meta.mttd_phrase ?? '')
    .replace('{exposure}', exposureText(v))
    .replace('{disruption}', String(v.disruption_hours))
}

/** "$1.67M" style compact money for prose. */
export function compactUsd(n: number): string {
  let s = (n / 1e6).toFixed(2)
  if (s.endsWith('0')) s = s.slice(0, -1)
  return '$' + s + 'M'
}
