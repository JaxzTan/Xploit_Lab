import type { AnalysisResult } from '../../api/types'
import { usd } from '../../lib/format'
import { EngineOnlyNote } from './EngineOnlyNote'

const BIG = { fontSize: 30, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em', marginTop: 'var(--space-2)' } as const

export function ReasoningTab({ r }: { r: AnalysisResult }) {
  const count = (v: string) => r.reasoning.filter((s) => s.verdict === v).length
  const est = r.ai_estimate
  const delta = est?.delta_pct_vs_engine
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="fapi-h1">AI reasoning</h1>
          <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
            The model’s written rationale for each step, returned in its structured response (not hidden chain-of-thought), with what the service accepted, corrected or rejected. The model estimates; the engine decides.
          </p>
        </div>
        {r.reasoning.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', flexWrap: 'wrap' }}>
            <span className="tag tag-neutral">{r.source === 'cached' ? 'golden output' : `${r.model} · temp 0`}</span>
            <span className="tag tag-outline">{count('accepted')} accepted · {count('corrected')} corrected · {count('rejected')} rejected</span>
          </div>
        )}
      </div>

      {!r.reasoning.length ? (
        <EngineOnlyNote what="No reasoning steps" />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 'var(--space-4)' }}>
            <div className="card">
              <div className="card-kicker">AI estimate · comparison only</div>
              <div className="tnum" style={BIG}>{est ? `${usd(est.low)} – ${usd(est.high)}` : '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>The model’s guess from technique knowledge and typical review thresholds</div>
            </div>
            <div className="card" style={{ boxShadow: '0 0 0 1px var(--color-accent-700), 0 6px 18px rgba(0,0,0,0.55)' }}>
              <div className="card-kicker" style={{ color: 'var(--color-accent-300)' }}>Engine (authoritative)</div>
              <div className="tnum" style={{ ...BIG, color: 'var(--color-accent-300)' }}>
                {r.verdict.complete ? '' : 'up to '}{usd(r.verdict.financial_exposure_usd)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                {delta != null ? `AI midpoint is ${delta >= 0 ? '+' : ''}${delta}% vs engine; engine wins by design` : 'Engine wins by design'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {r.reasoning.map((s) => (
              <div key={s.n} className="card" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
                <div className="fapi-step-badge" style={{ border: '1px solid var(--color-neutral-600)', color: 'var(--color-neutral-400)' }}>{s.n}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-heading)' }}>{s.title}</span>
                    <span className="fapi-verdict" data-verdict={s.verdict}>{s.verdict}</span>
                  </div>
                  <div style={{ color: 'var(--color-neutral-300)', fontSize: 13 }}>{s.thought}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{s.check}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
