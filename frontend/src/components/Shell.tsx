import type { ReactNode } from 'react'
import { MONO } from '../lib/format'

interface Props {
  endpoint: string
  right: ReactNode
  children: ReactNode
}

/** Header + footer shared by all three pages (design: FAPI Console / FAPI Verdict). */
export function Shell({ endpoint, right, children }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.5, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', flexWrap: 'wrap', padding: 'var(--space-4) var(--space-8)', borderBottom: '1px solid var(--color-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 16, letterSpacing: '-0.01em' }}>FAPI</span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Financial Attack Path Intelligence</span>
          <span className="tnum" style={{ fontSize: 11, color: 'var(--color-neutral-600)', fontFamily: MONO }}>{endpoint}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginLeft: 'auto', flexWrap: 'wrap' }}>{right}</div>
      </header>
      {children}
      <footer style={{ marginTop: 'auto', padding: 'var(--space-5) var(--space-8)', borderTop: '1px solid var(--color-divider)', fontSize: 12, color: 'var(--color-neutral-600)' }}>
        Synthetic data · Regulatory flag is a simplified rule, not legal advice
      </footer>
    </div>
  )
}

/** Uppercase section kicker (12px / 0.14em). */
export function Kicker({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: accent ? 'var(--color-accent-300)' : 'var(--color-neutral-500)' }}>
      {children}
    </div>
  )
}
