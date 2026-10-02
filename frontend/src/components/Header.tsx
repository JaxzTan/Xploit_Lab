import type { AnalyzeResponse, ScenarioSummary } from '../api/types'
import { isMock } from '../api/client'

interface Props {
  scenarios: ScenarioSummary[]
  scenarioId: string
  scenarioLabel: string
  analysis: AnalyzeResponse | null
  analyzing: boolean
  canAnalyze: boolean
  onSelect: (id: string) => void
  onAnalyze: () => void
}

const FALLBACK_TEXT: Record<string, string> = {
  timeout: 'Gemini timed out (8 s)',
  error: 'Gemini call failed',
  validation_failed: 'model path failed validation',
  no_api_key: 'no Gemini API key configured',
  demo_mode: 'DEMO_MODE=cached',
}

export function Header({ scenarios, scenarioId, scenarioLabel, analysis, analyzing, canAnalyze, onSelect, onAnalyze }: Props) {
  const sourceLabel = analysis ? 'source: ' + analysis.source : 'not analyzed'
  const fallback = analysis?.fallback_reason ? FALLBACK_TEXT[analysis.fallback_reason] ?? analysis.fallback_reason : null
  const analyzeLabel = analyzing ? 'Analyzing…' : analysis ? 'Re-run analysis' : 'Analyze'

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-6)', flexWrap: 'wrap',
        padding: 'var(--space-4) var(--space-8)', borderBottom: '1px solid var(--color-divider)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 16, letterSpacing: '-0.01em' }}>Xploit-Lab</span>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Financial Attack Path Intelligence</span>
        <span className="mono tnum" style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>
          POST /api/analyze{analysis ? ' · ' + analysis.scenario_id : ''}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginLeft: 'auto', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }} role="group" aria-label="Scenario">
          <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>scenario</span>
          {scenarios.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="fapi-pill"
              aria-pressed={opt.id === scenarioId}
              onClick={() => onSelect(opt.id)}
              disabled={analyzing}
            >
              {opt.name}
            </button>
          ))}
          {scenarioLabel && (
            <span className="tag tag-outline tnum">{scenarioLabel}</span>
          )}
        </div>
        {isMock && (
          <span className="tag tag-neutral mono" title="Running against the in-browser mock API (VITE_MOCK=1)">mock api</span>
        )}
        <span
          className="tag tag-neutral"
          title={fallback ? 'Served from the pre-validated cache: ' + fallback : analysis ? 'Reasoning returned live by Gemini' : undefined}
        >
          {sourceLabel}
          {fallback ? ' · ' + fallback : ''}
        </span>
        <button className="btn btn-primary" type="button" onClick={onAnalyze} disabled={analyzing || !canAnalyze}>
          {analyzeLabel}
        </button>
      </div>
    </header>
  )
}
