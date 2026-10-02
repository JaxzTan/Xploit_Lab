import type { CSSProperties } from 'react'
import type { AnalyzeResponse, GraphNode, Scenario } from '../api/types'
import { usd } from '../lib/format'
import { exposureText, fillNarrative, nodeIndex } from '../lib/scenario'

interface Props {
  scenario: Scenario
  analysis: AnalyzeResponse
}

const statValue: CSSProperties = { fontSize: 30, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em', lineHeight: 1.15 }

export function VerdictView({ scenario, analysis }: Props) {
  const v = analysis.verdict
  const { meta } = scenario
  const byId = nodeIndex(scenario)
  const { validation } = analysis

  const validatorLabel =
    `${validation.hops_verified}/${validation.hops_total} hops verified against config` +
    (validation.rejected_hops.length ? ` · ${validation.rejected_hops.length} rejected` : '')

  const statCards = [
    { kicker: 'Cyber risk', value: v.cyber_risk, note: meta.cyber_note ?? '', sub: '', style: { ...statValue, color: '#d2cefd' } },
    {
      kicker: 'Financial exposure',
      value: exposureText(v),
      note: meta.exp_note ?? '',
      sub: v.complete ? '' : 'INCOMPLETE — a factor has no evidence and is held at 1.0, so this is an upper bound.',
      style: { ...statValue, fontVariantNumeric: 'tabular-nums' },
    },
    { kicker: 'Disruption', value: v.disruption_hours + 'h', note: meta.recovery_policy ?? 'critical-tier lookup, rules.json', sub: '', style: statValue },
    {
      kicker: 'Regulatory',
      value: v.regulatory_status === 'MAJOR' ? 'MAJOR' : 'Below',
      note: meta.reg_secondary ?? 'DORA-aligned simplification',
      sub: (meta.reg_primary ?? '') + (meta.entity ? '  ·  ' + meta.entity : ''),
      style: statValue,
    },
  ]

  const headline = (meta.headline_lead ?? 'This scenario exposes ') + exposureText(v) + (meta.headline_tail ?? '')
  const narrative = fillNarrative(analysis.narrative, scenario, v)

  const expByNode: Record<string, number> = {}
  v.per_system.forEach((p) => (expByNode[p.node_id] = p.exposure_usd))
  const reachedSet = new Set(v.reached)
  const reachedList = scenario.nodes.filter((n) => reachedSet.has(n.id))

  return (
    <div className="fapi-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <div className="fapi-kicker-lg">Board verdict</div>
          <h1 style={{ margin: 'var(--space-2) 0 0', fontSize: 30, letterSpacing: '-0.02em' }}>{headline}</h1>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', paddingTop: 'var(--space-6)', flexWrap: 'wrap' }}>
          <span className="tag tag-accent" title={validation.bfs_subset ? 'systems_reached ⊆ code BFS' : 'BFS cross-check failed'}>
            {validatorLabel}
          </span>
          <span
            style={{
              fontSize: 11, padding: '3px 9px', borderRadius: 4,
              border: '1px solid ' + (v.complete ? 'rgba(233,233,237,0.16)' : '#5d5294'),
              color: v.complete ? '#9397ab' : '#d2cefd',
            }}
          >
            {v.complete ? 'complete' : 'INCOMPLETE'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-4)' }}>
        {statCards.map((c) => (
          <div key={c.kicker} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div className="card-kicker">{c.kicker}</div>
            <div style={c.style}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{c.note}</div>
            {c.sub && <div style={{ fontSize: 11, color: 'var(--color-accent-300)', marginTop: 2, lineHeight: 1.4 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-8)' }}>
        <LossBeforeDetection analysis={analysis} byId={byId} />
        <LossOverDwell analysis={analysis} byId={byId} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-8)' }}>
        <div>
          <h2 className="fapi-h2">Narrative</h2>
          <p style={{ margin: 0, maxWidth: '60ch', color: 'var(--color-neutral-300)' }}>{narrative}</p>
          <p style={{ margin: 'var(--space-4) 0 0', fontSize: 12, color: 'var(--color-neutral-600)' }}>
            Prose from Gemini; every figure injected server-side by template (TR-10).
          </p>
        </div>
        <div>
          <h2 className="fapi-h2">Systems reached</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {reachedList.map((n) => (
              <div
                key={n.id}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-divider)' }}
              >
                <span style={{ fontFamily: 'var(--font-heading)' }}>{n.name}</span>
                <span className="fapi-crit" data-crit={n.criticality}>
                  {n.criticality}
                </span>
                <span className="tnum" style={{ marginLeft: 'auto', color: 'var(--color-neutral-400)' }}>
                  {expByNode[n.id] ? usd(expByNode[n.id]) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ChartProps {
  analysis: AnalyzeResponse
  byId: Record<string, GraphNode>
}

function LossBeforeDetection({ analysis, byId }: ChartProps) {
  const v = analysis.verdict
  const caps = v.per_system.map((p) => p.exposed_capacity_24h_usd)
  const maxLimit = Math.max(1, ...caps)
  const totalLimit = caps.reduce((a, b) => a + b, 0)
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="card-kicker">Loss before detection</div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>engine · daily limit vs movable</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        {v.per_system.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>No financial system is reachable from the entry point.</div>
        )}
        {v.per_system.map((p) => (
          <div key={p.node_id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{byId[p.node_id]?.name ?? p.node_id}</span>
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>
                {(p.gap_unknown ? 'detection delay unknown' : 'detection delay ' + p.detection_delay_hours + 'h') +
                  ' · capacity ' +
                  usd(p.exposed_capacity_24h_usd)}
              </span>
              <span className="tnum" style={{ marginLeft: 'auto', color: 'var(--color-accent-300)' }}>
                {(p.gap_unknown || p.bypass_unknown ? 'up to ' : '') + usd(p.exposure_usd)}
              </span>
            </div>
            <div className="fapi-bar-track">
              <div className="fapi-bar-fill" style={{ width: (p.exposure_usd / maxLimit) * 100 + '%' }} />
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>Total movable</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>of {usd(totalLimit)} daily limit in reach</span>
            <span className="tnum" style={{ marginLeft: 'auto', fontFamily: 'var(--font-heading)' }}>
              {exposureText(v)}
            </span>
          </div>
          <div className="fapi-bar-track">
            <div className="fapi-bar-fill" style={{ width: (totalLimit ? (v.financial_exposure_usd / totalLimit) * 100 : 0) + '%' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

// Cumulative loss curve (presentation only): each reached system's engine-computed
// exposure is drawn accruing linearly from hour 4 to its configured detection delay.
const H = 24
const X0 = 0
const X1 = 348
const Y0 = 140
const Y1 = 6

function LossOverDwell({ analysis, byId }: ChartProps) {
  const v = analysis.verdict
  const lossAt = (h: number) =>
    v.per_system.reduce((a, p) => {
      const mttd = p.gap_unknown || p.detection_delay_hours == null ? 24 : p.detection_delay_hours
      const t = Math.max(0, Math.min(1, (h - 4) / Math.max(mttd - 4, 0.1)))
      return a + p.exposure_usd * t
    }, 0)
  const maxLoss = Math.max(v.financial_exposure_usd, 1)
  const px = (h: number) => X0 + (h / H) * (X1 - X0)
  const py = (val: number) => Y0 - (val / maxLoss) * (Y0 - Y1)
  const pts: string[] = []
  for (let h = 0; h <= H; h += 0.5) pts.push(px(h).toFixed(1) + ' ' + py(lossAt(h)).toFixed(1))
  const curveLine = 'M ' + pts.join(' L ')
  const curveArea = curveLine + ' L ' + X1 + ' ' + Y0 + ' L ' + X0 + ' ' + Y0 + ' Z'
  const gridLines = [0, 0.5, 1].map((f) => ({
    y: py(maxLoss * f),
    label: f === 0 ? '$0' : '$' + ((maxLoss * f) / 1e6).toFixed(1) + 'M',
  }))
  const detectMarks = v.per_system
    .filter((p) => !p.gap_unknown && p.detection_delay_hours != null)
    .map((p) => {
      const name = byId[p.node_id]?.name ?? p.node_id
      return {
        id: p.node_id,
        left: ((p.detection_delay_hours as number) / H) * 100 + '%',
        label: name.split('-')[0] + ' detected ' + p.detection_delay_hours + 'h',
      }
    })

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="card-kicker">Loss over dwell time</div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>cumulative, hour 0 → detection</span>
      </div>
      <div style={{ position: 'relative', marginTop: 'var(--space-3)', padding: '22px 0 18px 44px' }}>
        <div style={{ position: 'relative', height: 140 }}>
          <svg
            viewBox="0 0 348 140"
            preserveAspectRatio="none"
            role="img"
            aria-label={'Cumulative modeled loss rising to ' + usd(v.financial_exposure_usd) + ' by detection'}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'visible' }}
          >
            {gridLines.map((g) => (
              <line key={g.label} x1={0} x2={348} y1={g.y} y2={g.y} stroke="#3f424d" strokeWidth={1} strokeDasharray="2 4" />
            ))}
            <path d={curveArea} fill="rgba(145,132,217,0.12)" />
            <path d={curveLine} fill="none" stroke="#9184d9" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {gridLines.map((g) => (
            <span
              key={g.label}
              className="tnum"
              style={{
                position: 'absolute', right: '100%', marginRight: 6, top: (g.y / Y0) * 100 + '%', transform: 'translateY(-50%)',
                fontSize: 10, color: '#9397ab', whiteSpace: 'nowrap',
              }}
            >
              {g.label}
            </span>
          ))}
          {detectMarks.map((m) => (
            <div key={'l' + m.id} style={{ position: 'absolute', left: m.left, top: 0, bottom: 0, borderLeft: '1px dashed #d2cefd', opacity: 0.7 }} />
          ))}
          {detectMarks.map((m, i) => (
            <span
              key={'t' + m.id}
              className="tnum"
              style={{
                position: 'absolute', left: m.left, top: -20 + i * 12, transform: 'translateX(-100%)', paddingRight: 5,
                fontSize: 10, color: '#d2cefd', whiteSpace: 'nowrap',
              }}
            >
              {m.label}
            </span>
          ))}
          {[0, 6, 12, 18, 24].map((h) => (
            <span
              key={h}
              className="tnum"
              style={{ position: 'absolute', left: (h / H) * 100 + '%', top: '100%', marginTop: 4, transform: 'translateX(-50%)', fontSize: 10, color: '#9397ab' }}
            >
              {h}h
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
