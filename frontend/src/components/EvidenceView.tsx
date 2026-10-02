import type { AnalyzeResponse, Scenario } from '../api/types'
import { fixed2, usd } from '../lib/format'
import { exposureText, nodeIndex } from '../lib/scenario'

interface Props {
  scenario: Scenario
  analysis: AnalyzeResponse
}

const RULES_TEXT = `detection_window_factor(s) = min(detection_delay_hours / 24, 1.0)
control_multiplier(s)      = max over paths of Π edge.control_multiplier
modeled_exposure(s)        = exposed_capacity_24h_usd × detection_window_factor × control_multiplier
disruption_hours           = per-scenario recovery policy: multi-system value if ≥2 critical
                             financial systems reached; else the single-critical value
cyber_risk                 = HIGH if any critical reached, MEDIUM if any high
dora_classification        = Major ICT-related incident (simulated) if an EU-covered entity's
                             critical payment service is reached via unauthorized access
UNKNOWN factor             → 1.0, row marked UNKNOWN, verdict.complete = false`

const unknownStyle = { color: '#d2cefd' }

export function EvidenceView({ scenario, analysis }: Props) {
  const v = analysis.verdict
  const byId = nodeIndex(scenario)

  return (
    <div className="fapi-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div>
        <h1 className="fapi-h1">Evidence</h1>
        <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
          Every factor, its value, where it came from, and the rule that used it. Pure functions in{' '}
          <code style={{ color: 'var(--color-accent-300)' }}>engine/exposure.py</code> — no model output enters this table.
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
                <th style={{ textAlign: 'right' }}>Detection delay → factor</th>
                <th style={{ textAlign: 'right' }}>Path bypass</th>
                <th style={{ textAlign: 'right' }}>Exposure</th>
              </tr>
            </thead>
            <tbody>
              {v.per_system.map((p) => (
                <tr key={p.node_id}>
                  <td>{byId[p.node_id]?.name ?? p.node_id}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{usd(p.exposed_capacity_24h_usd)}</td>
                  <td className="tnum" style={{ textAlign: 'right', ...(p.gap_unknown ? unknownStyle : {}) }}>
                    {p.gap_unknown
                      ? 'UNKNOWN → 1.00'
                      : 'detection delay ' + p.detection_delay_hours + 'h → factor ' + fixed2(p.detection_window_factor)}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right', ...(p.bypass_unknown ? unknownStyle : {}) }}>
                    {fixed2(p.control_multiplier) + ' (' + p.chain.join('×') + ')' + (p.bypass_unknown ? ' · UNKNOWN' : '')}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right', color: 'var(--color-accent-300)' }}>
                    {(p.gap_unknown || p.bypass_unknown ? 'up to ' : '') + usd(p.exposure_usd)}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={{ fontFamily: 'var(--font-heading)' }}>Total</td>
                <td />
                <td />
                <td />
                <td className="tnum" style={{ textAlign: 'right', fontFamily: 'var(--font-heading)' }}>{exposureText(v)}</td>
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
              {v.evidence.map((r, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--color-neutral-300)' }}>{r.factor}</td>
                  <td className="tnum" style={r.unknown ? unknownStyle : undefined}>
                    {r.value}
                    {r.unknown && !/UNKNOWN/.test(r.value) ? ' · UNKNOWN' : ''}
                  </td>
                  <td style={{ color: 'var(--color-neutral-500)', fontSize: 12 }}>{r.source}</td>
                  <td>
                    <span className="tnum" style={{ fontSize: 11, color: '#9397ab', whiteSpace: 'nowrap' }}>{r.rule_id}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 'min(100%, 780px)' }}>
        <div className="card-kicker">Rules as approved 19 Sep 2026</div>
        <pre
          className="mono"
          style={{ margin: 'var(--space-3) 0 0', fontSize: 12, lineHeight: 1.7, color: 'var(--color-neutral-400)', whiteSpace: 'pre-wrap' }}
        >
          {RULES_TEXT}
        </pre>
      </div>
    </div>
  )
}
