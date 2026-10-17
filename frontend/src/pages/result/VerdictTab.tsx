import type { AnalysisResult } from '../../api/types'
import { Kicker } from '../../components/Shell'
import { hours, usd } from '../../lib/format'

const BIG = { fontSize: 30, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em' } as const

export function headline(r: AnalysisResult): string {
  const v = r.verdict
  if (!r.per_system.length) return `No financial system is reachable from ${r.entry}`
  return `An attacker at ${r.entry} can move ${v.complete ? '' : 'up to '}${usd(v.financial_exposure_usd)} before anyone notices`
}

export function VerdictTab({ r }: { r: AnalysisResult }) {
  const v = r.verdict
  const nodes = Object.fromEntries(r.graph.nodes.map((n) => [n.id, n]))
  const firstCritical = r.reached.find((id) => nodes[id]?.criticality === 'critical')
  const checked = r.validation.hops
  const validatorLabel = r.source === 'engine_only' ? 'engine only · AI unavailable' : `${checked.filter((h) => h.ok).length}/${checked.length} hops verified against config`

  const cards = [
    { kicker: 'Cyber risk', value: v.cyber_risk, accent: true,
      note: firstCritical ? `${firstCritical} (critical) is reachable` : v.cyber_risk === 'MEDIUM' ? 'highest tier reached: high' : 'no critical or high node reached' },
    { kicker: 'Financial exposure', value: (v.complete ? '' : 'up to ') + usd(v.financial_exposure_usd),
      note: `movable before detection, ${r.per_system.length} system${r.per_system.length === 1 ? '' : 's'}` },
    { kicker: 'Disruption', value: hours(v.disruption_hours), note: 'highest criticality tier reached, rules' },
    { kicker: 'Regulatory', value: v.regulatory_status, note: `critical function reached ∧ total ≥ ${usd(v.threshold_usd)}` },
  ]

  // Loss before detection: engine exposure against each system's daily limit.
  const maxLimit = Math.max(1, ...r.per_system.map((p) => p.limit))
  const totalLimit = r.per_system.reduce((a, p) => a + p.limit, 0)

  // Cumulative loss: each system accrues linearly from its impact start to its MTTD (illustrative).
  const startOf = (id: string) => r.phases.find((p) => p.impact && p.system === id)?.start_h ?? 0
  const mttdOf = (p: AnalysisResult['per_system'][number]) => p.mttd_h ?? 24
  const H = Math.max(24, Math.ceil(Math.max(0, ...r.per_system.map(mttdOf)) / 6) * 6)
  const X1 = 348, Y0 = 140, Y1 = 6
  const lossAt = (h: number) =>
    r.per_system.reduce((a, p) => {
      const s = startOf(p.node_id)
      const t = Math.max(0, Math.min(1, (h - s) / Math.max(mttdOf(p) - s, 0.1)))
      return a + p.exposure * t
    }, 0)
  const maxLoss = Math.max(v.financial_exposure_usd, 1)
  const px = (h: number) => (h / H) * X1
  const py = (val: number) => Y0 - (val / maxLoss) * (Y0 - Y1)
  const pts: string[] = []
  for (let h = 0; h <= H; h += H / 48) pts.push(`${px(h).toFixed(1)} ${py(lossAt(h)).toFixed(1)}`)
  const line = 'M ' + pts.join(' L ')
  const area = `${line} L ${X1} ${Y0} L 0 ${Y0} Z`
  const grid = [0, 0.5, 1].map((f) => ({ y: py(maxLoss * f), label: f === 0 ? '$0' : `$${((maxLoss * f) / 1e6).toFixed(1)}M` }))
  const marks = r.per_system.filter((p) => p.mttd_h != null)
  const ticks = [0, 1, 2, 3, 4].map((i) => (H / 4) * i)
  const exposureOf = Object.fromEntries(r.per_system.map((p) => [p.node_id, p.exposure]))

  const narrativeNote =
    r.source === 'engine_only'
      ? 'Engine template: the AI step was unavailable. Every figure is computed.'
      : `Prose from ${r.source === 'cached' ? 'the golden model output' : 'Gemini'}; every figure injected server-side by template (TR-10).`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <Kicker>Board verdict</Kicker>
          <h1 style={{ margin: 'var(--space-2) 0 0', fontSize: 30, letterSpacing: '-0.02em' }}>{headline(r)}</h1>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', paddingTop: 'var(--space-6)', flexWrap: 'wrap' }}>
          <span className="tag tag-accent">{validatorLabel}</span>
          <span className="fapi-complete" data-complete={v.complete}>{v.complete ? 'complete' : 'incomplete'}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--space-4)' }}>
        {cards.map((c) => (
          <div key={c.kicker} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div className="card-kicker">{c.kicker}</div>
            <div className="tnum" style={{ ...BIG, color: c.accent ? 'var(--color-accent-300)' : undefined }}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{c.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 'var(--space-8)' }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="card-kicker">Loss before detection</div>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>engine · daily limit vs movable</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            {r.per_system.map((p) => (
              <div key={p.node_id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{p.node_id}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{p.mttd_h == null ? 'MTTD unknown' : `MTTD ${hours(p.mttd_h)}`} · limit {usd(p.limit)}</span>
                  <span className="tnum" style={{ marginLeft: 'auto', color: 'var(--color-accent-300)' }}>{usd(p.exposure)}</span>
                </div>
                <div className="fapi-bar-track"><div className="fapi-bar-fill" style={{ width: `${(p.exposure / maxLimit) * 100}%` }} /></div>
              </div>
            ))}
            {!r.per_system.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>No reachable financial system.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>Total movable</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>of {usd(totalLimit)} daily limit in reach</span>
                <span className="tnum" style={{ marginLeft: 'auto', fontFamily: 'var(--font-heading)' }}>{usd(v.financial_exposure_usd)}</span>
              </div>
              <div className="fapi-bar-track"><div className="fapi-bar-fill" style={{ width: `${totalLimit ? (v.financial_exposure_usd / totalLimit) * 100 : 0}%` }} /></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div className="card-kicker">Loss over dwell time</div>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)' }}>cumulative, hour 0 → detection · illustrative</span>
          </div>
          <div style={{ position: 'relative', marginTop: 'var(--space-3)', padding: '22px 0 18px 44px' }}>
            <div style={{ position: 'relative', height: 140 }}>
              <svg viewBox={`0 0 ${X1} ${Y0}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'visible' }} role="img" aria-label="Cumulative loss curve">
                {grid.map((g) => <line key={g.label} x1={0} x2={X1} y1={g.y} y2={g.y} stroke="#3f424d" strokeWidth={1} strokeDasharray="2 4" />)}
                <path d={area} fill="rgba(145,132,217,0.12)" />
                <path d={line} fill="none" stroke="#9184d9" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
              {grid.map((g) => (
                <span key={g.label} className="tnum" style={{ position: 'absolute', right: '100%', marginRight: 6, top: `${(g.y / Y0) * 100}%`, transform: 'translateY(-50%)', fontSize: 10, color: '#9397ab', whiteSpace: 'nowrap' }}>{g.label}</span>
              ))}
              {marks.map((p, i) => (
                <div key={p.node_id}>
                  <div style={{ position: 'absolute', left: `${(p.mttd_h! / H) * 100}%`, top: 0, bottom: 0, borderLeft: '1px dashed #d2cefd', opacity: 0.7 }} />
                  <span className="tnum" style={{ position: 'absolute', left: `${(p.mttd_h! / H) * 100}%`, top: -20 + i * 12, transform: 'translateX(-100%)', paddingRight: 5, fontSize: 10, color: '#d2cefd', whiteSpace: 'nowrap' }}>
                    {p.node_id.split('-')[0]} detected {hours(p.mttd_h!)}
                  </span>
                </div>
              ))}
              {ticks.map((h) => (
                <span key={h} className="tnum" style={{ position: 'absolute', left: `${(h / H) * 100}%`, top: '100%', marginTop: 4, transform: 'translateX(-50%)', fontSize: 10, color: '#9397ab' }}>{hours(h)}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 'var(--space-8)' }}>
        <div>
          <h2 className="fapi-h2">Narrative</h2>
          <p style={{ margin: 0, maxWidth: '60ch', color: 'var(--color-neutral-300)' }}>{r.narrative}</p>
          <p style={{ margin: 'var(--space-4) 0 0', fontSize: 12, color: 'var(--color-neutral-600)' }}>{narrativeNote}</p>
        </div>
        <div>
          <h2 className="fapi-h2">Systems reached</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {r.reached.map((id) => (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ fontFamily: 'var(--font-heading)' }}>{id}</span>
                <span className="fapi-crit" data-crit={nodes[id]?.criticality}>{nodes[id]?.criticality}</span>
                <span className="tnum" style={{ marginLeft: 'auto', color: 'var(--color-neutral-400)' }}>{exposureOf[id] != null ? usd(exposureOf[id]) : '—'}</span>
              </div>
            ))}
            {!r.reached.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Nothing is reachable from {r.entry} over allowed edges.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
