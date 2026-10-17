import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AiInputEvent, ErrorEvent, InputsEvent, RunEvent, StageEvent, ValidationEvent } from '../api/types'
import { Kicker } from '../components/Shell'
import { inspect } from '../lib/inspect'
import { MONO, hours, pr, usd } from '../lib/format'
import type { RunState } from '../App'

const FIRST_STEP_MS = 300
const STEP_MS = 700 // minimum time each step stays on screen, so a cached run is still readable

interface Props {
  run: RunState
  onBack: () => void
  onRetry: () => void
  onOpen: () => void
}

function pick<E extends RunEvent['event']>(events: RunEvent[], name: E) {
  return events.filter((e) => e.event === name).map((e) => e.data) as Extract<RunEvent, { event: E }>['data'][]
}

/** Which design step (0–5) the stream has reached. */
function streamStage(events: RunEvent[]): number {
  const stages = pick(events, 'stage')
  if (events.some((e) => e.event === 'result')) return 5
  if (stages.some((s) => s.id === 'engine' && s.status === 'done')) return 4
  if (stages.some((s) => s.id === 'gemini_call' || s.id === 'load_golden') || events.some((e) => e.event === 'error')) return 3
  if (events.some((e) => e.event === 'inputs')) return 2
  if (stages.some((s) => s.id === 'parse')) return 1
  return 0
}

export function Processing({ run, onBack, onRetry, onOpen }: Props) {
  const { events, result } = run
  const target = streamStage(events)
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (shown >= target) return
    const t = window.setTimeout(() => setShown((s) => s + 1), shown === 0 ? FIRST_STEP_MS : STEP_MS)
    return () => window.clearTimeout(t)
  }, [shown, target])

  const info = useMemo(() => inspect(run.json), [run.json])
  const data = info.data
  const inputs = pick(events, 'inputs')[0] as InputsEvent | undefined
  const aiInput = pick(events, 'ai_input')[0] as AiInputEvent | undefined
  const aiOutput = pick(events, 'ai_output')[0]
  const validation = pick(events, 'validation')[0] as ValidationEvent | undefined
  const errors = pick(events, 'error') as ErrorEvent[]
  const stages = pick(events, 'stage') as StageEvent[]
  const aiStage = [...stages].reverse().find((s) => s.id === 'gemini_call' || s.id === 'load_golden')

  const done = shown >= 5
  const running = !done && run.status !== 'error'
  const named = data as { scenario?: string; scenario_id?: string } | null
  const title = `${named?.scenario ?? named?.scenario_id ?? 'Untitled scenario'} · entry ${info.entry ?? '?'}`

  const inputStats = data
    ? [
        { k: 'Nodes', v: data.nodes.length },
        { k: 'Edges', v: data.edges.length },
        { k: 'Financial', v: data.nodes.filter((n) => n.type === 'financial').length },
        { k: 'Blocked edges', v: data.edges.filter((e) => !e.allowed).length },
      ]
    : []
  const top = inputs?.priority[0]?.exposure || 1

  const aiMeta = !aiStage
    ? ''
    : aiStage.id === 'load_golden'
      ? 'golden output for this input hash · no model call'
      : aiStage.status === 'running'
        ? `${aiInput?.model ?? 'model'} · temperature 0`
        : `${aiInput?.model ?? 'model'} · ${aiStage.meta}`
  const engineOnly = result?.source === 'engine_only'
  const rejected = (validation?.hops ?? []).filter((h) => !h.ok)

  return (
    <main className="fi-in" style={{ padding: 'var(--space-6) var(--space-8) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 920, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div>
          <Kicker accent>Step 2 · Processing</Kicker>
          <h1 style={{ margin: 'var(--space-2) 0 0', fontSize: 24, letterSpacing: '-0.02em', fontWeight: 500 }}>{title}</h1>
          <p style={{ margin: 'var(--space-1) 0 0', fontSize: 13, color: 'var(--color-neutral-500)' }}>
            What data went in, which of it counts as priority, what the AI wrote and what the engine computed.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" type="button" onClick={onBack}>Edit data</button>
          <button className="btn btn-secondary" type="button" disabled={running} onClick={() => setShown(0)}>Replay</button>
          <button className="btn btn-primary" type="button" disabled={!done || !result} onClick={onOpen}>Open verdict</button>
        </div>
      </div>

      <div style={{ height: 2, background: 'var(--color-neutral-800)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: 2, background: 'var(--color-accent)', transition: 'width 500ms ease', width: `${Math.min(100, shown * 20)}%` }} />
      </div>

      {run.status === 'error' && (
        <div role="alert" className="card" style={{ border: '1px solid var(--color-err)', background: 'transparent' }}>
          <div style={{ fontSize: 13 }}>The analysis stream failed: {run.error}</div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-secondary" type="button" onClick={onRetry}>Retry</button>
            <button className="btn btn-ghost" type="button" onClick={onBack}>Edit data</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column' }} aria-live="polite">
        {shown >= 1 && (
          <Step index="01" title="Input received">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 'var(--space-2)' }}>
              {inputStats.map((s) => (
                <div key={s.k} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-neutral-900)' }}>
                  <div className="tnum" style={{ fontSize: 20, fontFamily: 'var(--font-heading)' }}>{s.v}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{s.k}</div>
                </div>
              ))}
            </div>
          </Step>
        )}

        {shown >= 2 && inputs && (
          <Step index="02" title="Data used, ranked by priority" gap="var(--space-4)">
            <Group tag="tag-accent" name="Priority" note="Drives the exposure number. Ranked by exposure at stake.">
              {inputs.priority.map((p, i) => (
                <div key={p.node_id} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr)', gap: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent-800)', background: 'var(--color-neutral-900)' }}>
                  <span className="tnum" style={{ fontSize: 12, color: 'var(--color-accent-300)', paddingTop: 2 }}>{i + 1}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontFamily: MONO, overflowWrap: 'anywhere' }}>{p.node_id}</span>
                      <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-accent-300)' }}>{usd(p.exposure)} exposure</span>
                    </div>
                    <div style={{ height: 2, background: 'var(--color-neutral-800)', borderRadius: 2 }}>
                      <div style={{ height: 2, borderRadius: 2, background: 'var(--color-accent)', width: `${Math.max(4, Math.round((p.exposure / top) * 100))}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <Chip k="limit" v={usd(p.limit)} />
                      <Chip k="P(path)" v={pr(p.bypass) + (p.bypass_unknown ? ' · UNKNOWN' : '')} />
                      <Chip k="MTTD" v={p.mttd_h == null ? 'missing' : hours(p.mttd_h)} />
                      {p.critical_function && <Chip k="critical fn" v="yes" />}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', fontFamily: MONO, overflowWrap: 'anywhere' }}>{p.route.join(' → ')}</div>
                  </div>
                </div>
              ))}
              {!inputs.priority.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: 'var(--space-3)' }}>No financial system reachable from the entry point.</div>}
            </Group>
            <Group tag="tag-neutral" name="Supporting" note="Read, but only scales or labels the priority data.">
              {inputs.supporting.map((u) => (
                <div key={u.label} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', padding: '6px 0', borderBottom: '1px solid var(--color-divider)' }}>
                  <span style={{ fontSize: 12, fontFamily: MONO, whiteSpace: 'nowrap' }}>{u.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{u.note}</span>
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>{u.value}</span>
                </div>
              ))}
            </Group>
            <Group tag="tag-outline" name="Not used" note="Present in the input but off every attack path.">
              {inputs.not_used.map((g) => (
                <div key={g.label} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', padding: '6px 0', borderBottom: '1px solid var(--color-divider)', opacity: 0.75 }}>
                  <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{g.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-500)', textAlign: 'right' }}>{g.note}</span>
                </div>
              ))}
              {!inputs.not_used.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Everything in the input is on a path.</div>}
            </Group>
          </Step>
        )}

        {shown >= 3 && (
          <Step index="03" title="Generated by AI" sub="names and wording only, no numbers" meta={aiMeta}>
            {errors.map((e, i) => (
              <div key={i} role="status" style={{ fontSize: 12, color: 'var(--color-warn)', display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-warn)', flex: 'none' }} />
                <span>{e.message}. {e.fallback === 'cached' ? 'Using the golden output recorded for this exact input.' : 'Engine-only result: techniques and reasoning are not named.'}</span>
              </div>
            ))}
            {shown >= 4 && result && !engineOnly &&
              result.hops.map((h) => (
                <div key={h.edge_id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-divider)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <span title="Validator: allowed edge, endpoints match" style={{ color: 'var(--color-accent)', fontSize: 12 }}>✓</span>
                    <span style={{ fontSize: 12, fontFamily: MONO, overflowWrap: 'anywhere' }}>{h.route}</span>
                    <span className="tag tag-accent" style={{ marginLeft: 'auto', fontFamily: MONO }}>{h.mitre_id} · {h.technique}</span>
                  </div>
                  {h.rationale && <div style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{h.rationale}</div>}
                </div>
              ))}
            {shown >= 4 && rejected.map((h) => (
              <div key={h.edge_id} style={{ display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-neutral-700)', fontSize: 12, opacity: 0.8 }}>
                <span style={{ color: 'var(--color-err)' }}>✗</span>
                <span style={{ fontFamily: MONO }}>{h.edge_id} · {h.route}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--color-neutral-500)' }}>dropped: {h.reason}</span>
              </div>
            ))}
            {shown >= 4 && validation && (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
                Validator: {validation.hops.filter((h) => h.ok).length}/{validation.hops.length} hops on allowed edges ·{' '}
                {validation.bfs_subset ? 'systems_reached ⊆ BFS' : `BFS wins, dropped ${validation.extra.join(', ')}`} ·{' '}
                reasoning {validation.reasoning_verdicts.accepted} accepted, {validation.reasoning_verdicts.corrected} corrected, {validation.reasoning_verdicts.rejected} rejected
              </div>
            )}
            {shown === 3 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 12, color: 'var(--color-neutral-400)' }}>
                <span className="fi-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--color-accent)' }} />
                <span>Writing reasoning…</span>
              </div>
            )}
            {aiInput && (
              <details className="fi-raw">
                <summary>What the AI takes <span>· {aiInput.prompt_redactions.join(', ')} withheld</span></summary>
                <pre>{JSON.stringify(aiInput.payload, null, 2)}</pre>
              </details>
            )}
            {aiOutput != null && shown >= 4 && (
              <details className="fi-raw">
                <summary>What the AI returned <span>· raw structured reply</span></summary>
                <pre>{JSON.stringify(aiOutput, null, 2)}</pre>
              </details>
            )}
          </Step>
        )}

        {shown >= 4 && inputs && (
          <Step index="04" title="Computed by engine" last>
            {inputs.priority.map((p) => (
              <div key={p.node_id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-neutral-900)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{p.node_id}</span>
                  <span className="tnum" style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--color-accent-300)', whiteSpace: 'nowrap' }}>{usd(p.exposure)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', fontFamily: MONO, overflowWrap: 'anywhere' }}>
                  P = {p.chain_probs.map(pr).join(' × ')} = {pr(p.bypass)} · gap = {p.gap_unknown ? 'UNKNOWN → 1' : `${hours(p.mttd_h!)} / 24 = ${pr(p.gap)}`} · exposure = {usd(p.limit)} × {pr(p.gap)} × {pr(p.bypass)}
                  {p.over_threshold ? ' · over threshold' : ''}
                </div>
              </div>
            ))}
            {!inputs.priority.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Nothing to compute: no reachable financial system.</div>}
            {done && result && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
                {[
                  { k: 'Total exposure', v: (result.verdict.complete ? '' : 'up to ') + usd(result.verdict.financial_exposure_usd) },
                  { k: 'Reachable targets', v: String(result.per_system.length) },
                  { k: 'Max disruption', v: hours(result.verdict.disruption_hours) },
                  { k: 'Regulatory', v: result.verdict.regulatory_status },
                ].map((t) => (
                  <div key={t.k} style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{t.k}</span>
                    <span className="tnum" style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{t.v}</span>
                  </div>
                ))}
              </div>
            )}
          </Step>
        )}
      </div>
    </main>
  )
}

function Step({ index, title, sub, meta, last, gap = 'var(--space-3)', children }: { index: string; title: string; sub?: string; meta?: string; last?: boolean; gap?: string; children: ReactNode }) {
  return (
    <div className="fi-in-step" style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--color-accent)', marginTop: 6 }} />
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--color-neutral-700)' }} />}
      </div>
      <section style={{ display: 'flex', flexDirection: 'column', gap, paddingBottom: last ? 0 : 'var(--space-8)', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{index}</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>{title}</span>
          {sub && <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{sub}</span>}
          {meta && <span className="tnum" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-600)', fontFamily: MONO }}>{meta}</span>}
        </div>
        {children}
      </section>
    </div>
  )
}

function Group({ tag, name, note, children }: { tag: string; name: string; note: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className={`tag ${tag}`}>{name}</span>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{note}</span>
      </div>
      {children}
    </div>
  )
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="tnum" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontSize: 11, padding: '1px 8px', borderRadius: 999, background: 'var(--color-neutral-800)', color: 'var(--color-neutral-300)' }}>
      <span style={{ color: 'var(--color-neutral-500)' }}>{k}</span>
      <span>{v}</span>
    </span>
  )
}
