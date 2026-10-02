export type ViewKey = 'verdict' | 'path' | 'timeline' | 'reasoning' | 'why' | 'whatif'

export const TABS: { key: ViewKey; label: string }[] = [
  { key: 'verdict', label: 'Verdict' },
  { key: 'path', label: 'Attack path' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'reasoning', label: 'AI reasoning' },
  { key: 'why', label: 'Evidence' },
  { key: 'whatif', label: 'Remediation' },
]

interface Props {
  view: ViewKey
  enabled: boolean
  onChange: (v: ViewKey) => void
}

export function TabNav({ view, enabled, onChange }: Props) {
  return (
    <nav
      role="tablist"
      aria-label="Analysis views"
      style={{
        display: 'flex', gap: 'var(--space-1)', padding: '0 var(--space-8)',
        borderBottom: '1px solid var(--color-divider)', overflowX: 'auto',
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          className="fapi-tab"
          aria-selected={enabled && view === t.key}
          disabled={!enabled}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
