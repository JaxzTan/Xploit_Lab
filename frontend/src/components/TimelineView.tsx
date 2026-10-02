import type { AnalyzeResponse } from '../api/types'
import { usd } from '../lib/format'
import { compactUsd } from '../lib/scenario'

interface Props {
  analysis: AnalyzeResponse
}

const isImpact = (phase: string) => phase.indexOf('Impact') === 0

/** "Impact — wire (Branch A)" → "wire". */
const branchName = (phase: string) => {
  const m = phase.match(/—\s*([^()]+?)\s*(\(|$)/)
  return m ? m[1] : phase
}

export function TimelineView({ analysis }: Props) {
  const phases = analysis.phases
  const branches = phases.filter((p) => isImpact(p.phase) && p.branch_exposure)

  // Running total of the per-branch exposure the server attached to each impact phase.
  let cum = 0
  const steps = phases.map((ph, idx) => {
    const impact = isImpact(ph.phase)
    if (impact && ph.branch_exposure) cum += ph.branch_exposure
    return { ...ph, n: idx + 1, impact, cum, isLast: idx === phases.length - 1 }
  })

  const branchSentence =
    branches.length >= 2
      ? ' Exposure is counted only once the attacker reaches a financial system, and accrues per branch: ' +
        branches.map((b, i) => (i === 0 ? 'the ' : 'then the ') + branchName(b.phase) + ' branch adds ' + compactUsd(b.branch_exposure as number)).join(', ') +
        '.'
      : ' Exposure is counted only once the attacker reaches a financial system.'

  const cumColor = (impact: boolean, value: number) =>
    impact ? 'var(--color-accent-300)' : value > 0 ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)'

  return (
    <div className="fapi-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div>
        <h1 className="fapi-h1">Attack progression and cumulative modeled exposure</h1>
        <p className="fapi-lede" style={{ maxWidth: '64ch' }}>
          Narrative timeline — each hop as a kill-chain phase, what happened, and the running modeled exposure. This is financial
          capacity reachable under the scenario’s assumptions, not observed loss.{branchSentence}
        </p>
      </div>

      <ol style={{ display: 'flex', flexDirection: 'column', gap: 0, listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((st) => (
          <li key={st.n}>
            <div
              style={{
                display: 'grid', gridTemplateColumns: '30px 150px minmax(0, 1fr) auto', gap: 'var(--space-4)', alignItems: 'center',
                padding: 'var(--space-4)', borderRadius: 'var(--radius-md)',
                border: '1px solid ' + (st.impact ? 'var(--color-accent)' : 'rgba(233,233,237,0.16)'),
                background: st.impact ? 'rgba(145,132,217,0.06)' : 'var(--color-surface-2)',
              }}
            >
              <div
                className="tnum"
                style={{
                  width: 30, height: 30, flex: 'none', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-heading)', fontSize: 13,
                  border: '1px solid ' + (st.impact ? 'var(--color-accent)' : 'var(--color-neutral-700)'),
                  color: st.impact ? 'var(--color-accent-300)' : 'var(--color-neutral-400)',
                  background: st.impact ? 'rgba(145,132,217,0.14)' : 'transparent',
                }}
              >
                {st.n}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="tnum" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>
                  {st.tactic}
                </div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 14, marginTop: 2 }}>{st.phase}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-neutral-400)', lineHeight: 1.5 }}>{st.detail}</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>Cumulative exposure</div>
                <div
                  className="tnum"
                  style={{ fontFamily: 'var(--font-heading)', fontSize: 22, letterSpacing: '-0.02em', color: cumColor(st.impact, st.cum) }}
                >
                  {usd(st.cum)}
                </div>
              </div>
            </div>
            {!st.isLast && (
              <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-neutral-700)', fontSize: 13, padding: '2px 0' }}>
                ↓
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>
          Cumulative exposure progression
        </span>
        {steps.map((st) => (
          <span key={st.n} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span
              className="tnum"
              style={{
                fontFamily: 'var(--font-heading)', fontSize: 12, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
                border: '1px solid ' + (st.impact ? 'var(--color-accent)' : 'rgba(233,233,237,0.16)'),
                color: cumColor(st.impact, st.cum),
                background: st.impact ? 'rgba(145,132,217,0.14)' : 'transparent',
              }}
            >
              {usd(st.cum)}
            </span>
            {!st.isLast && <span style={{ color: 'var(--color-neutral-700)', fontSize: 12 }}>→</span>}
          </span>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-neutral-600)', textAlign: 'center' }}>
        Illustrative synthetic values for demonstration — detection window is the config detection delay, not a model estimate.
      </p>
    </div>
  )
}
