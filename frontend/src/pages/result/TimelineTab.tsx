import type { AnalysisResult } from '../../api/types'
import { hours, usd } from '../../lib/format'
import { EngineOnlyNote } from './EngineOnlyNote'

export function TimelineTab({ r }: { r: AnalysisResult }) {
  const intro = (
    <div>
      <h1 className="fapi-h1">Attack timeline</h1>
      <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
        The model maps each hop to a kill-chain phase and estimates dwell per phase; the detection line comes from the config MTTD, not the model. Loss only accrues while the attacker is past the last control and before detection. Illustrative synthetic values.
      </p>
    </div>
  )
  if (!r.phases.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        {intro}
        <EngineOnlyNote what="No kill-chain phases" />
      </div>
    )
  }

  const detected = r.per_system.filter((p) => p.mttd_h != null)
  const H = Math.max(24, Math.ceil(Math.max(...r.phases.map((p) => p.end_h), ...detected.map((p) => p.mttd_h!)) / 4) * 4)
  const pct = (h: number) => `${(h / H) * 100}%`
  const ticks = Array.from({ length: H / 4 + 1 }, (_, i) => i * 4)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      {intro}
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 'var(--space-4)' }}>
            <span />
            <div style={{ position: 'relative', height: 18 }}>
              {ticks.map((h) => (
                <span key={h} className="tnum" style={{ position: 'absolute', left: pct(h), top: 0, transform: 'translateX(-50%)', fontSize: 10, color: '#9397ab' }}>{h}h</span>
              ))}
            </div>
          </div>
          {r.phases.map((p, i) => {
            const wide = ((p.end_h - p.start_h) / H) * 100 > 20
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{p.phase}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{p.tactic_id}</div>
                </div>
                <div style={{ position: 'relative', height: 30, borderBottom: '1px solid var(--color-divider)' }}>
                  {detected.map((d) => <div key={d.node_id} style={{ position: 'absolute', top: 0, bottom: -1, left: pct(d.mttd_h!), borderLeft: '1px dashed #d2cefd', opacity: 0.6 }} />)}
                  <div style={{ position: 'absolute', top: 5, height: 20, left: pct(p.start_h), width: pct(p.end_h - p.start_h), minWidth: 4, borderRadius: 4, background: p.impact ? 'rgba(145,132,217,0.28)' : '#2c2e3b', border: `1px solid ${p.impact ? '#9184d9' : '#3f424d'}` }} />
                  <span className="tnum" style={{ position: 'absolute', top: 5, height: 20, display: 'flex', alignItems: 'center', fontSize: 11, whiteSpace: 'nowrap', left: pct(wide ? p.start_h : p.end_h), paddingLeft: 8, color: wide ? '#e9e9ed' : '#9397ab', pointerEvents: 'none' }}>
                    {p.impact && p.system ? `${usd(p.accrues_usd)} movable` : `${hours(p.end_h - p.start_h)} dwell`}
                  </span>
                </div>
              </div>
            )
          })}
          <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13, color: 'var(--color-accent-300)' }}>Detection</div>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>SOC MTTD, from the input</div>
            </div>
            <div style={{ position: 'relative', height: 30 }}>
              {detected.map((d, i) => (
                <div key={d.node_id} className="tnum" style={{ position: 'absolute', left: pct(d.mttd_h!), top: i % 2 ? 16 : 0, transform: 'translateX(-50%)', fontSize: 10, color: '#d2cefd', whiteSpace: 'nowrap', borderTop: '1px solid #d2cefd', paddingTop: 2 }}>
                  {d.node_id} · {hours(d.mttd_h!)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="fapi-h2">Phase detail</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {r.phases.map((p, i) => (
            <div key={i} className="card" style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 'var(--space-4)' }}>
              <div className="tnum" style={{ color: 'var(--color-accent-300)', fontSize: 13 }}>{p.start_h}h – {p.end_h}h</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-heading)' }}>{p.phase}</span>
                  <span className="tag tag-outline">{p.tactic_id}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>
                    {p.impact && p.system ? `accrues ${usd(p.accrues_usd)} · end from ${p.end_source === 'config_mttd' ? 'config MTTD' : p.end_source}` : 'no loss yet'}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{p.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
