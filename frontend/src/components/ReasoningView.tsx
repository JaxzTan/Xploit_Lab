import type { CSSProperties } from 'react'
import type { AnalyzeResponse } from '../api/types'
import { usd } from '../lib/format'
import { exposureText } from '../lib/scenario'

interface Props {
  analysis: AnalyzeResponse
}

const verdictStyle = (v: string): CSSProperties => ({
  fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
  border: '1px solid ' + (v === 'accepted' ? '#3f424d' : v === 'corrected' || v === 'deferred' ? '#5d5294' : '#595d6c'),
  color: v === 'accepted' ? '#9397ab' : v === 'corrected' ? '#d2cefd' : v === 'deferred' ? '#b5abfc' : '#cfd3e5',
  textDecoration: v === 'rejected' ? 'line-through' : 'none',
})

export function ReasoningView({ analysis }: Props) {
  const { reasoning, verdict } = analysis
  const count = (v: string) => reasoning.filter((r) => r.verdict === v).length
  const modelLabel = analysis.source === 'cached' ? 'golden_path.json' : 'Gemini · temperature 0'

  return (
    <div className="fapi-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="fapi-h1">AI reasoning</h1>
          <p className="fapi-lede" style={{ maxWidth: '62ch' }}>
            The model's chain of thought as returned in the structured response, with what the service accepted, corrected, or
            rejected. The model estimates; the engine decides.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <span className="tag tag-neutral">{modelLabel}</span>
          <span className="tag tag-outline">
            {count('accepted')} accepted · {count('corrected')} corrected · {count('rejected')} rejected
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
        <div className="card">
          <div className="card-kicker">AI estimate</div>
          <div style={{ fontSize: 30, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em', marginTop: 'var(--space-2)' }}>
            deferred to engine
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            Gemini does not estimate the dollar figure or detection delays — by design. It maps the path; code owns every number.
          </div>
        </div>
        <div className="card" style={{ boxShadow: '0 0 0 1px var(--color-accent-700), 0 6px 18px rgba(0,0,0,0.55)' }}>
          <div className="card-kicker" style={{ color: 'var(--color-accent-300)' }}>Engine (authoritative)</div>
          <div
            className="tnum"
            style={{ fontSize: 30, fontFamily: 'var(--font-heading)', letterSpacing: '-0.02em', marginTop: 'var(--space-2)', color: 'var(--color-accent-300)' }}
          >
            {exposureText(verdict)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            Financial exposure is computed deterministically ({usd(verdict.financial_exposure_usd)}), not inferred by the model.
          </div>
        </div>
      </div>

      <ol style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', listStyle: 'none', margin: 0, padding: 0 }}>
        {reasoning.map((r, i) => (
          <li key={i} className="card" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
            <div className="fapi-step-badge" style={{ border: '1px solid var(--color-neutral-600)', color: 'var(--color-neutral-400)' }}>
              {i + 1}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-heading)' }}>{r.title}</span>
                <span style={verdictStyle(r.verdict)}>{r.verdict}</span>
              </div>
              <div style={{ color: 'var(--color-neutral-300)', fontSize: 13 }}>{r.thought}</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{r.check}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
