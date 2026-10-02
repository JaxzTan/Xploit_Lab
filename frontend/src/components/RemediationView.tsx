import type { Scenario, Verdict, WhatIfResponse } from '../api/types'
import { usd } from '../lib/format'
import { verdictRows } from '../lib/scenario'

interface Props {
  scenario: Scenario
  baseline: Verdict
  applied: string[]
  whatIf: WhatIfResponse | null
  pending: boolean
  error: string | null
  onToggle: (changeId: string) => void
}

const bigLabel = { fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--color-neutral-500)' }
const bigValue = { fontSize: 38, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' as const, marginTop: 'var(--space-2)' }

export function RemediationView({ scenario, baseline, applied, whatIf, pending, error, onToggle }: Props) {
  const appliedSet = new Set(applied)
  const appliedList = scenario.changes.filter((c) => appliedSet.has(c.id))
  const anyGap = appliedList.some((c) => c.op === 'clear_evidence')

  // Every figure below comes from POST /api/what-if; with nothing applied, before == after == the analysis verdict.
  const before = whatIf?.before ?? baseline
  const after = whatIf?.after ?? baseline
  const avoided = whatIf?.avoided_usd ?? 0
  const effort = whatIf?.effort_hours ?? 0
  const removed = whatIf?.removed_edges ?? []
  const cleared = whatIf?.cleared_evidence ?? []

  const effortText = effort ? effort + ' engineering hour' + (effort > 1 ? 's' : '') : '—'
  const roiText = effort && avoided > 0 ? usd(avoided / effort) + ' / hr' : '—'
  const removedText = removed.join(', ') || 'none'

  const note = anyGap
    ? 'Unknown ≠ safe: with a detection-delay factor cleared, the engine holds that branch at its full ceiling and marks the verdict incomplete — exposure is reported as an upper bound. Toggle it back off to restore the measured figure.'
    : appliedList.length === 0
      ? 'Toggle any combination of fixes. Each is applied to a deep copy of the graph, BFS and the engine re-run, and the residual recomputed — no model call. Branch-level fixes cut one route; the shared-path fixes cut both at higher effort.'
      : 'Applied ' + appliedList.length + ' fix' + (appliedList.length > 1 ? 'es' : '') + ' (' + effort + 'h): residual ' +
        (after.complete ? '' : 'up to ') + usd(after.financial_exposure_usd) +
        '. Branch-level controls reduce only part of the exposure; the shared-path fixes close both routes at greater operational cost. This is the auditable remediation trade-off.'

  return (
    <div className="fapi-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div>
        <h1 className="fapi-h1">Remediation</h1>
        <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
          Toggle any combination of fixes. Each applies to a graph copy, then BFS and the engine re-run — no model call.
          Branch-level fixes cut one route; the shared-path fixes cut both, at higher effort.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
        {scenario.changes.map((c) => {
          const on = appliedSet.has(c.id)
          const cuts = c.cuts ? c.cuts : c.op === 'clear_evidence' ? 'evidence' : ''
          return (
            <button key={c.id} type="button" className="fapi-change" aria-pressed={on} onClick={() => onToggle(c.id)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%' }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{c.label}</span>
                <span
                  style={{
                    marginLeft: 'auto', fontSize: 10, letterSpacing: '0.08em', fontFamily: 'var(--font-heading)', padding: '3px 9px', borderRadius: 999,
                    border: '1px solid ' + (on ? 'var(--color-accent)' : 'var(--color-neutral-700)'),
                    color: on ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                    background: on ? 'rgba(145,132,217,0.14)' : 'transparent', flex: 'none',
                  }}
                >
                  {on ? 'APPLIED' : 'OFF'}
                </span>
              </span>
              <span
                style={{
                  fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 999,
                  border: '1px solid ' + (c.cuts === 'both' ? 'var(--color-accent)' : 'rgba(233,233,237,0.16)'),
                  color: c.cuts === 'both' ? 'var(--color-accent-300)' : 'var(--color-neutral-500)',
                }}
              >
                cuts: {cuts}
              </span>
              <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', lineHeight: 1.45 }}>{c.note}</span>
              <span className="tnum" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
                {(c.op === 'clear_evidence' ? 'clear_evidence · ' : 'remove_edge · ') + c.target + ' · ' + (c.effort || 0) + 'h'}
              </span>
            </button>
          )
        })}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--color-danger)' }}>
          What-if recompute failed: {error}. The figures below are from the last successful run.
        </div>
      )}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)',
          opacity: pending ? 0.6 : 1, transition: 'opacity 140ms ease',
        }}
        aria-busy={pending}
      >
        <div className="card">
          <div className="card-kicker">Before</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            {verdictRows(before).map((b) => (
              <div key={b.k} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', borderBottom: '1px solid var(--color-divider)', paddingBottom: 'var(--space-2)' }}>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{b.k}</span>
                <span className="tnum" style={{ marginLeft: 'auto' }}>{b.v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ boxShadow: '0 0 0 1px var(--color-accent-700), 0 6px 18px rgba(0,0,0,0.55)' }}>
          <div className="card-kicker" style={{ color: 'var(--color-accent-300)', display: 'flex', gap: 8 }}>
            After
            {pending && <span style={{ color: 'var(--color-neutral-500)', textTransform: 'none', letterSpacing: 0 }}>recomputing…</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            {verdictRows(after).map((a) => (
              <div key={a.k} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', borderBottom: '1px solid var(--color-divider)', paddingBottom: 'var(--space-2)' }}>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{a.k}</span>
                <span className="tnum" style={{ marginLeft: 'auto', color: '#d2cefd' }}>{a.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex', alignItems: 'flex-end', gap: 'var(--space-8)', flexWrap: 'wrap',
          borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-6)',
        }}
      >
        <div>
          <div style={bigLabel}>{anyGap ? 'Unmeasured exposure added' : 'Exposure removed'}</div>
          <div style={{ ...bigValue, color: 'var(--color-accent-300)' }}>{(avoided < 0 ? '+' : '') + usd(Math.abs(avoided))}</div>
        </div>
        <div>
          <div style={bigLabel}>{after.financial_exposure_usd <= 0 ? 'Fully mitigated' : 'Residual exposure'}</div>
          <div style={{ ...bigValue, color: 'var(--color-neutral-300)' }}>
            {(after.complete ? '' : 'up to ') + usd(after.financial_exposure_usd)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-8)', paddingBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Effort</div>
            <div className="tnum">{effortText}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Per engineering hour</div>
            <div className="tnum">{roiText}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Edges removed</div>
            <div className="tnum">{removedText}</div>
          </div>
          {cleared.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Evidence cleared</div>
              <div className="tnum">{cleared.map((c) => c.node_id + '.' + c.field).join(', ')}</div>
            </div>
          )}
        </div>
      </div>

      <p style={{ margin: 0, maxWidth: '62ch', color: 'var(--color-neutral-400)' }}>{note}</p>
    </div>
  )
}
