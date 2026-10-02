import type { AnalyzeResponse, Scenario, WhatIfResponse } from '../api/types'
import { fixed2 } from '../lib/format'
import { displayName } from '../lib/scenario'
import { AttackGraph } from './AttackGraph'

interface Props {
  scenario: Scenario
  analysis: AnalyzeResponse
  whatIf: WhatIfResponse | null
  showDenied: boolean
  onToggleDenied: () => void
  focus: string | null
  onFocus: (edgeId: string) => void
}

export function AttackPathView({ scenario, analysis, whatIf, showDenied, onToggleDenied, focus, onFocus }: Props) {
  const byId = Object.fromEntries(scenario.nodes.map((n) => [n.id, n]))
  const edgeById = Object.fromEntries(scenario.edges.map((e) => [e.edge_id, e]))
  const removed = whatIf?.removed_edges ?? []
  const removedSet = new Set(removed)
  const label = (id: string) => displayName(byId[id], id)

  const hops = analysis.path.path_edge_ids.map((id, i) => {
    const e = edgeById[id]
    const step = analysis.path.steps.find((s) => s.evidence_edge === id)
    const from = e?.source ?? step?.from ?? ''
    const to = e?.destination ?? step?.to ?? ''
    return {
      n: i + 1,
      id,
      route: label(from) + ' → ' + label(to),
      permission: e?.permission ?? '',
      technique: analysis.techniques[id] ?? step?.technique ?? '',
      evidence: e?.evidence ?? '',
      bypass: 'bypass ' + fixed2(e?.control_multiplier) + ' · ' + id,
      hasInfo: !!analysis.hop_details[id],
      cut: removedSet.has(id),
    }
  })

  return (
    <div className="fapi-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="fapi-h1">Attack path</h1>
          <p className="fapi-lede" style={{ maxWidth: '58ch' }}>
            Entry at {scenario.meta.entry_label}. Solid accent edges are the validated path; hairlines are other allowed
            relationships; dashed are denied by policy and never traversed.
            {removed.length > 0 && (
              <span style={{ color: 'var(--color-danger)' }}>
                {' '}
                Red dashed edges are cut by the fixes applied in Remediation ({removed.join(', ')}).
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto' }}>
          <button className="btn btn-secondary" type="button" onClick={onToggleDenied}>
            {showDenied ? 'Hide denied edges' : 'Show denied edges'}
          </button>
        </div>
      </div>

      <AttackGraph
        scenario={scenario}
        reached={analysis.verdict.reached}
        reachedAfter={whatIf && (removed.length > 0 || whatIf.cleared_evidence.length > 0) ? whatIf.after.reached : null}
        onPath={analysis.path.on_path}
        pathEdgeIds={analysis.path.path_edge_ids}
        removedEdges={removed}
        showDenied={showDenied}
        animate
      />

      <div>
        <h2 className="fapi-h2">Hops — technique named by Gemini, edge verified against config</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {hops.map((h) => (
            <div
              key={h.id}
              className="card"
              style={{
                display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'start',
                boxShadow: h.cut ? '0 0 0 1px var(--color-danger)' : undefined,
              }}
            >
              <div
                className="fapi-step-badge"
                style={{ border: '1px solid var(--color-accent)', color: 'var(--color-accent)' }}
              >
                {h.n}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-heading)', textDecoration: h.cut ? 'line-through' : undefined }}>{h.route}</span>
                  <span className="tag tag-outline">{h.permission}</span>
                  {h.cut && (
                    <span className="tag" style={{ border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}>
                      cut by fix
                    </span>
                  )}
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>
                    {h.bypass}
                  </span>
                  {h.hasInfo && (
                    <button
                      type="button"
                      className="fapi-info-btn"
                      title="How this technique works"
                      aria-label={'How this technique works: hop ' + h.n}
                      aria-expanded={focus === h.id}
                      onClick={() => onFocus(h.id)}
                    >
                      i
                    </button>
                  )}
                </div>
                <div style={{ color: 'var(--color-accent-300)', fontSize: 13 }}>{h.technique}</div>
                <div style={{ color: 'var(--color-neutral-400)', fontSize: 13 }}>{h.evidence}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
