import { useState } from 'react'
import type { AnalysisResult, VerdictSummary } from '../../api/types'
import { Kicker } from '../../components/Shell'
import { usd } from '../../lib/format'

const rows = (v: VerdictSummary) => [
  { k: 'Cyber risk', v: v.cyber_risk },
  { k: 'Financial exposure', v: (v.complete ? '' : 'up to ') + usd(v.financial_exposure_usd) },
  { k: 'Disruption', v: `${Math.round(v.disruption_hours * 10) / 10} hours` },
  { k: 'Regulatory', v: v.regulatory_status + (v.complete ? '' : ' · INCOMPLETE') },
]

export function WhatIfTab({ r }: { r: AnalysisResult }) {
  const [selected, setSelected] = useState(r.what_ifs[0]?.id ?? '')
  const change = r.what_ifs.find((w) => w.id === selected)

  const intro = (
    <div>
      <h1 className="fapi-h1">What-if</h1>
      <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
        A graph copy, one mutation, code traversal and the engine again. No model call, and every change was precomputed with the run, so it returns instantly and identically every time.
      </p>
    </div>
  )
  if (!change) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        {intro}
        <div style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>No changes to try: nothing on an attack path.</div>
      </div>
    )
  }

  const gap = change.op === 'clear_evidence'
  const avoided = change.avoided_usd
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      {intro}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 'var(--space-3)' }}>
        {r.what_ifs.map((w) => (
          <button key={w.id} type="button" className="fapi-change" aria-pressed={w.id === selected} onClick={() => setSelected(w.id)}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{w.label}</span>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', lineHeight: 1.45 }}>{w.note}</span>
            <span className="tnum" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
              {w.op} · {w.target}{w.op === 'remove_edge' && w.effort_hours ? ` · ${w.effort_hours}h` : ''}
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 'var(--space-4)' }}>
        <div className="card">
          <div className="card-kicker">Before</div>
          <Rows list={rows(r.verdict)} />
        </div>
        <div className="card" style={{ boxShadow: '0 0 0 1px var(--color-accent-700), 0 6px 18px rgba(0,0,0,0.55)' }}>
          <div className="card-kicker" style={{ color: 'var(--color-accent-300)' }}>After</div>
          <Rows list={rows(change.after)} accent />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-8)', flexWrap: 'wrap', borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-6)' }}>
        <div>
          <Kicker>{avoided < 0 ? 'Unmeasured exposure added' : 'Avoided exposure'}</Kicker>
          <div className="tnum" style={{ fontSize: 38, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em', color: 'var(--color-accent-300)', marginTop: 'var(--space-2)' }}>
            {avoided < 0 ? '+' : ''}{usd(Math.abs(avoided))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-8)', paddingBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Stat k="Effort" v={change.effort_hours ? `${change.effort_hours} engineering hour${change.effort_hours === 1 ? '' : 's'}` : '—'} />
          <Stat k="Per engineering hour" v={change.per_hour_usd != null ? usd(change.per_hour_usd) : '—'} />
          <Stat k="Edges removed" v={change.removed_edges.join(', ') || 'none'} />
        </div>
      </div>

      <p style={{ margin: 0, maxWidth: '62ch', color: 'var(--color-neutral-400)' }}>
        {gap
          ? `With no ${change.field} on ${change.target} the engine substitutes 1.0, marks the row UNKNOWN and sets complete = false. The verdict is reported as an upper bound, not a number: that gap is worth ${usd(Math.abs(avoided))} of uncertainty.`
          : `Computed on a deep copy of the graph: ${change.target} removed, BFS re-run, engine re-run. The original graph is untouched and no model was called.`}
      </p>
    </div>
  )
}

function Rows({ list, accent }: { list: { k: string; v: string }[]; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
      {list.map((x) => (
        <div key={x.k} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', borderBottom: '1px solid var(--color-divider)', paddingBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{x.k}</span>
          <span className="tnum" style={{ marginLeft: 'auto', color: accent ? '#d2cefd' : undefined }}>{x.v}</span>
        </div>
      ))}
    </div>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{k}</div>
      <div className="tnum">{v}</div>
    </div>
  )
}
