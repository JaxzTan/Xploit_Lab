import { useEffect, useRef } from 'react'
import type { GraphEdge, HopDetail } from '../api/types'

interface Props {
  edgeId: string
  edge: GraphEdge | undefined
  detail: HopDetail
  onClose: () => void
}

const sectionLabel = {
  fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase' as const,
  color: 'var(--color-neutral-600)', marginBottom: 'var(--space-3)',
}
const bodyText = { margin: 0, color: 'var(--color-neutral-300)', fontSize: 14, lineHeight: 1.55 }

export function HopDrawer({ edgeId, edge, detail, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])

  const techRoute = edge ? edge.source + ' → ' + edge.destination : ''

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,11,18,0.55)', zIndex: 60 }} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="hop-drawer-title"
        className="fapi-drawer"
        style={{
          position: 'fixed', top: 0, right: 0, height: '100%', width: 'min(440px, 92vw)', background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-neutral-700)', zIndex: 61, display: 'flex', flexDirection: 'column',
          boxShadow: '-16px 0 40px rgba(0,0,0,0.5)', animation: 'fapi-in 220ms ease-out',
        }}
      >
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)',
            padding: 'var(--space-6)', borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="tnum" style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>
              {techRoute} · {edgeId}
            </div>
            <div id="hop-drawer-title" style={{ fontFamily: 'var(--font-heading)', fontSize: 18, letterSpacing: '-0.01em', marginTop: 'var(--space-2)' }}>
              {detail.title}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              appearance: 'none', cursor: 'pointer', flex: 'none', width: 30, height: 30, borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-neutral-700)', background: 'transparent', color: 'var(--color-neutral-400)', fontSize: 15, lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <div>
            <div style={sectionLabel}>How it works</div>
            <p style={bodyText}>{detail.how}</p>
          </div>
          <div>
            <div style={sectionLabel}>How the attacker leverages it</div>
            <p style={bodyText}>{detail.leverage}</p>
          </div>
          {detail.refs && detail.refs.length > 0 && (
            <div>
              <div style={sectionLabel}>Reference frameworks</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {detail.refs.map((r) => (
                  <div key={r.fw + r.id} style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)' }}>
                    <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>{r.fw}</div>
                    <div className="tnum" style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-accent-300)', fontSize: 13, marginTop: 1 }}>
                      {r.id}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginTop: 1 }}>{r.lbl}</div>
                  </div>
                ))}
              </div>
              <p style={{ margin: 'var(--space-3) 0 0', fontSize: 11.5, fontStyle: 'italic', color: 'var(--color-neutral-600)' }}>
                These frameworks establish how the technique works. They do not validate the dollar figure — that is a separate,
                deterministic calculation.
              </p>
            </div>
          )}
          {detail.determined && (
            <div>
              <div style={sectionLabel}>How the engine treats it</div>
              <div
                style={{
                  fontSize: 13, color: 'var(--color-neutral-400)', background: 'var(--color-surface-2)', border: '1px solid var(--color-divider)',
                  borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', lineHeight: 1.55,
                }}
              >
                {detail.determined}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
