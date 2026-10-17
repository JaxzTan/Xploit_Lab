import { useMemo, useState } from 'react'
import type { AnalysisResult } from '../../api/types'
import { MONO, hours, usd } from '../../lib/format'
import { edgePath, layout, NODE_W } from '../../lib/layout'

export function PathTab({ r }: { r: AnalysisResult }) {
  const [showDenied, setShowDenied] = useState(true)
  const [focus, setFocus] = useState<string | null>(null)
  const { nodes, edges } = r.graph
  const lay = useMemo(() => layout(nodes, edges, r.entry), [nodes, edges, r.entry])
  const onPathEdge = new Set(r.path_edges)
  const onPathNode = new Set(r.on_path)
  const reached = new Set(r.reached)
  const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const focused = focus ? nodes.find((n) => n.id === focus) : null
  const exposure = focused ? r.per_system.find((p) => p.node_id === focused.id) : undefined

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="fapi-h1">Attack path</h1>
          <p className="fapi-lede" style={{ maxWidth: '58ch' }}>
            Entry at {r.entry}. Solid accent edges are the validated path; hairlines are other allowed relationships; dashed are denied by policy and never traversed. Click a node for its details.
          </p>
        </div>
        <button className="btn btn-secondary" type="button" style={{ marginLeft: 'auto' }} onClick={() => setShowDenied((s) => !s)}>
          {showDenied ? 'Hide denied edges' : 'Show denied edges'}
        </button>
      </div>

      <div className="fapi-graph" style={{ overflow: 'auto' }}>
        <div style={{ position: 'relative', width: lay.width, height: lay.height }}>
          <svg width={lay.width} height={lay.height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
            {edges
              .filter((e) => e.allowed || showDenied)
              .map((e) => {
                const a = lay.pos[e.source]
                const b = lay.pos[e.destination]
                if (!a || !b) return null
                const { d, arrow } = edgePath(a, b)
                const hot = onPathEdge.has(e.edge_id)
                return (
                  <g key={e.edge_id}>
                    <path d={d} fill="none" stroke={hot ? '#9184d9' : '#3f424d'} strokeWidth={hot ? 2 : 1} strokeDasharray={e.allowed ? undefined : '3 6'} style={hot ? { filter: 'drop-shadow(0 0 5px rgba(145,132,217,0.5))' } : undefined} />
                    {hot && animate && <path className="fapi-flow" d={d} fill="none" stroke="#e7e5fe" strokeWidth={2} strokeDasharray="2 14" strokeLinecap="round" opacity={0.85} />}
                    <polygon points={arrow} fill={hot ? '#9184d9' : '#3f424d'} />
                  </g>
                )
              })}
          </svg>
          {nodes.map((n) => {
            const p = lay.pos[n.id]
            if (!p) return null
            return (
              <button
                key={n.id}
                type="button"
                className="fapi-node"
                data-reached={reached.has(n.id)}
                data-onpath={onPathNode.has(n.id)}
                aria-pressed={focus === n.id}
                onClick={() => setFocus((f) => (f === n.id ? null : n.id))}
                style={{ position: 'absolute', left: p.x, top: p.y, width: NODE_W, transform: 'translate(-50%, -50%)', cursor: 'pointer', font: 'inherit' }}
              >
                {n.id === r.entry && <span className="fapi-entry-flag">entry</span>}
                <div style={{ fontSize: 12, fontFamily: 'var(--font-heading)', letterSpacing: '-0.005em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name ?? n.id}</div>
                <div style={{ fontSize: 10, color: 'var(--color-neutral-500)', display: 'flex', gap: 6, marginTop: 2, whiteSpace: 'nowrap' }}>
                  <span>{n.type}</span>
                  <span>{n.transaction_limit_usd != null ? `${usd(n.transaction_limit_usd)} / day` : n.criticality}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {focused && (
        <div className="card fapi-in" style={{ boxShadow: '0 0 0 1px var(--color-accent-700)' }} aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{focused.id}</span>
            <span className="fapi-crit" data-crit={focused.criticality}>{focused.criticality}</span>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{focused.type}{focused.critical_function ? ' · critical function' : ''}</span>
            <button className="btn btn-ghost" type="button" style={{ marginLeft: 'auto' }} onClick={() => setFocus(null)}>Close</button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>
            {focused.id === r.entry ? 'Attacker entry point.' : reached.has(focused.id) ? 'Reachable from the entry over allowed edges.' : 'Not reachable from the entry.'}
            {focused.transaction_limit_usd != null && ` Limit ${usd(focused.transaction_limit_usd)} / day.`}
            {focused.type === 'financial' && ` MTTD ${focused.mttd_hours != null ? hours(focused.mttd_hours) : 'missing (UNKNOWN)'}.`}
            {exposure && ` Engine exposure ${usd(exposure.exposure)}.`}
          </div>
          {edges.filter((e) => e.source === focused.id || e.destination === focused.id).map((e) => (
            <div key={e.edge_id} style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--color-divider)', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: MONO, color: onPathEdge.has(e.edge_id) ? 'var(--color-accent-300)' : 'var(--color-neutral-400)' }}>{e.edge_id} · {e.source} → {e.destination}</span>
              <span style={{ color: 'var(--color-neutral-500)' }}>{e.permission}</span>
              <span className="tnum" style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }}>
                {e.allowed ? `bypass ${e.control_bypass_probability != null ? e.control_bypass_probability.toFixed(2) : 'UNKNOWN'}` : 'denied'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="fapi-h2">Hops: technique named by {r.source === 'engine_only' ? 'nobody (AI unavailable)' : 'the model'}, edge verified against config</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {r.hops.map((h) => (
            <div key={h.edge_id} className="card" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 'var(--space-4)', alignItems: 'start' }}>
              <div className="fapi-step-badge" style={{ border: '1px solid var(--color-accent)', color: 'var(--color-accent)' }}>{h.n}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-heading)' }}>{h.route}</span>
                  <span className="tag tag-outline">{h.permission}</span>
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>
                    bypass {h.bypass != null ? h.bypass.toFixed(2) : 'UNKNOWN'} · {h.edge_id}
                  </span>
                </div>
                <div style={{ color: 'var(--color-accent-300)', fontSize: 13 }}>{h.technique}{h.mitre_id ? ` (${h.mitre_id})` : ''}</div>
                {(h.evidence || h.rationale) && <div style={{ color: 'var(--color-neutral-400)', fontSize: 13 }}>{h.evidence ?? h.rationale}</div>}
              </div>
            </div>
          ))}
          {!r.hops.length && <div style={{ fontSize: 13, color: 'var(--color-neutral-500)' }}>No hop leads to a financial system.</div>}
        </div>
      </div>
    </div>
  )
}
