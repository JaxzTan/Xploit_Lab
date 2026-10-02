import type { CSSProperties } from 'react'

export interface PipelineItem {
  label: string
  meta: string
}

interface Props {
  items: PipelineItem[]
  step: number
  error: string | null
  onRetry: () => void
}

export function Pipeline({ items, step, error, onRetry }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: '64px 0' }} aria-live="polite">
      {items.map((p, i) => {
        const failed = error !== null && i === step
        const row: CSSProperties = {
          display: 'flex', alignItems: 'center', gap: 11, padding: '11px 0',
          borderBottom: '1px solid rgba(233,233,237,0.16)', fontSize: 13,
          color: failed ? 'var(--color-danger)' : i <= step ? '#e9e9ed' : '#595d6c',
        }
        const dot: CSSProperties = {
          width: 8, height: 8, borderRadius: 999, display: 'inline-block', flex: 'none',
          background: failed ? 'var(--color-danger)' : i < step ? '#9184d9' : 'transparent',
          border: '1px solid ' + (failed ? 'var(--color-danger)' : i <= step ? '#9184d9' : '#3f424d'),
          borderTopColor: i === step && !failed ? 'transparent' : undefined,
          animation: i === step && !failed ? 'fapi-spin 1s linear infinite' : 'none',
        }
        return (
          <div key={p.label} style={row}>
            <span style={dot} />
            <span>{p.label}</span>
            <span className="tnum" style={{ marginLeft: 'auto', color: failed ? 'var(--color-danger)' : 'var(--color-neutral-600)' }}>
              {failed ? 'failed' : i <= step ? p.meta : 'queued'}
            </span>
          </div>
        )
      })}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-4)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>Analysis did not complete: {error}</span>
          <button className="btn btn-secondary" type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
