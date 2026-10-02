import type { Scenario } from '../api/types'

interface Props {
  scenario: Scenario
  analyzing: boolean
  onAnalyze: () => void
}

export function IdleState({ scenario, analyzing, onAnalyze }: Props) {
  const { meta } = scenario
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-4)', padding: '64px 0 40px' }}>
      <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-accent-300)' }}>
        Scenario loaded
      </div>
      <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, letterSpacing: '-0.02em', maxWidth: '18ch' }}>{meta.idle_h1}</h1>
      <p style={{ margin: 0, maxWidth: '62ch', color: 'var(--color-neutral-400)' }}>
        {meta.idle_intro} — {scenario.nodes.length} nodes and {scenario.edges.length} edges — is loaded from{' '}
        <code style={{ color: 'var(--color-accent-300)' }}>bank.json</code>. Analysis asks Gemini to name the technique at each
        hop, validates every hop against the config, cross-checks reachability with a code BFS, then runs the exposure engine.
        Every number on the next screen is computed here, not written by the model.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" type="button" onClick={onAnalyze} disabled={analyzing}>
          Run analysis
        </button>
        {scenario.source === 'cached' && (
          <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
            Server is in <code style={{ color: 'var(--color-accent-300)' }}>DEMO_MODE=cached</code> — no model call.
          </span>
        )}
      </div>
    </div>
  )
}
