import type { AnalysisResult } from '../../api/types'
import { MONO, usd } from '../../lib/format'

export function WhyTab({ r }: { r: AnalysisResult }) {
  const tiers = r.rules.disruption_hours
  const rules = [
    'detection_gap(s) = min(mttd_hours / 24, 1.0)',
    'path_bypass(s)   = max over paths of Π edge.control_bypass_probability',
    'exposure(s)      = transaction_limit_usd × detection_gap × path_bypass',
    `disruption       = max{critical: ${tiers.critical}, high: ${tiers.high}, medium: ${tiers.medium}} over reached`,
    'cyber_risk       = HIGH if any critical reached, MEDIUM if any high',
    `regulatory       = MATERIAL if critical_function reached AND total ≥ ${usd(r.rules.materiality_threshold_usd)}`,
    'UNKNOWN factor   → 1.0, row marked UNKNOWN, verdict.complete = false',
  ].join('\n')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div>
        <h1 className="fapi-h1">Show me why</h1>
        <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
          Every factor, its value, where it came from, and the rule that used it. Pure functions in{' '}
          <code style={{ color: 'var(--color-accent-300)' }}>app/v1/engine.py</code>; no model output enters this table.
        </p>
      </div>

      <div>
        <h2 className="fapi-h2">Per-system exposure</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>System</th>
                <th style={{ textAlign: 'right' }}>Daily limit</th>
                <th style={{ textAlign: 'right' }}>MTTD → gap</th>
                <th style={{ textAlign: 'right' }}>Path bypass</th>
                <th style={{ textAlign: 'right' }}>Exposure</th>
              </tr>
            </thead>
            <tbody>
              {r.per_system.map((p) => (
                <tr key={p.node_id}>
                  <td>{p.node_id}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{usd(p.limit)}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{p.gap_unknown ? 'UNKNOWN → 1.00' : `${p.mttd_h}h → ${p.gap.toFixed(2)}`}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{p.bypass.toFixed(2)} ({p.chain.join('×')}){p.bypass_unknown ? ' · UNKNOWN' : ''}</td>
                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--color-accent-300)' }}>{usd(p.exposure)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ fontFamily: 'var(--font-heading)' }}>Total</td>
                <td />
                <td />
                <td />
                <td className="tnum" style={{ textAlign: 'right', fontFamily: 'var(--font-heading)' }}>
                  {r.verdict.complete ? '' : 'up to '}{usd(r.verdict.financial_exposure_usd)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="fapi-h2">Evidence ledger</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Factor</th>
                <th style={{ textAlign: 'left' }}>Value</th>
                <th style={{ textAlign: 'left' }}>Source</th>
                <th style={{ textAlign: 'left' }}>Rule</th>
              </tr>
            </thead>
            <tbody>
              {r.evidence.map((e, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--color-neutral-300)' }}>{e.factor}</td>
                  <td className="tnum" style={{ color: e.unknown ? 'var(--color-warn)' : undefined }}>{e.value}</td>
                  <td style={{ color: 'var(--color-neutral-500)', fontSize: 12 }}>{e.source}</td>
                  <td><span className="tnum" style={{ fontSize: 11, color: '#9397ab' }}>{e.rule_id}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '62ch' }}>
        <div className="card-kicker">Rules as approved 19 Sep 2026, values from this input</div>
        <pre style={{ margin: 'var(--space-3) 0 0', fontSize: 12, lineHeight: 1.7, color: 'var(--color-neutral-400)', whiteSpace: 'pre-wrap', fontFamily: MONO }}>{rules}</pre>
      </div>
    </div>
  )
}
