import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { fetchSample } from '../api/v1'
import type { Issue } from '../api/types'
import { Kicker } from '../components/Shell'
import { inspect, type CheckLevel } from '../lib/inspect'
import { MONO } from '../lib/format'

const DOT: Record<CheckLevel, string> = { ok: 'var(--color-accent)', warn: 'var(--color-warn)', err: 'var(--color-err)' }

const SCHEMA = [
  { key: 'nodes[]', note: 'id, type, criticality; financial: transaction_limit_usd, mttd_hours' },
  { key: 'edges[]', note: 'edge_id, source, destination, permission, allowed, control_bypass_probability' },
  { key: 'entry', note: 'attacker start node (optional)' },
  { key: 'rules', note: 'disruption_hours_by_criticality, regulatory_threshold_usd' },
  { key: 'what_ifs[]', note: 'optional: remove_edge / clear_evidence changes with effort_hours' },
]

interface Props {
  json: string
  onJson: (v: string) => void
  onRun: () => void
  /** Errors the server returned for the last submit (422), shown as failed checks. */
  serverIssues: Issue[]
}

export function Console({ json, onJson, onRun, serverIssues }: Props) {
  const info = useMemo(() => inspect(json), [json])
  const [sampleError, setSampleError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const valid = info.valid

  const checks = [
    ...info.checks,
    ...serverIssues.map((i) => ({ level: 'err' as const, label: `Server: ${i.path}`, detail: i.msg })),
  ]

  const loadSample = () => {
    setSampleError(null)
    fetchSample()
      .then((s) => onJson(JSON.stringify(s, null, 2)))
      .catch((e) => setSampleError(`Couldn’t load the sample: ${e instanceof Error ? e.message : String(e)}`))
  }
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => onJson(String(rd.result))
    rd.readAsText(f)
    e.target.value = ''
  }
  const onFormat = () => {
    try {
      onJson(JSON.stringify(JSON.parse(json), null, 2))
    } catch {
      /* Format is disabled until the text parses */
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && valid) {
      e.preventDefault()
      onRun()
    }
  }

  const hint = valid ? 'Enter to run · Shift+Enter for new line' : json.trim() ? 'Fix the errors to run' : 'Waiting for JSON'
  const dot = !json.trim() ? 'var(--color-neutral-600)' : valid && !serverIssues.length ? 'var(--color-accent)' : 'var(--color-err)'

  return (
    <main className="fi-in" style={{ padding: 'var(--space-8)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-8)', maxWidth: 1120, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', minWidth: 0 }}>
        <div>
          <Kicker accent>Step 1 · Prompt</Kicker>
          <h1 style={{ margin: 'var(--space-2) 0 0', fontSize: 28, lineHeight: 1.2, letterSpacing: '-0.02em', fontWeight: 500 }}>Key in the environment as JSON</h1>
          <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-neutral-400)', maxWidth: '62ch' }}>
            Nodes, edges and optional rules. The model only names techniques and writes reasoning; every number is computed from what you key in.
          </p>
        </div>

        <div className="fi-composer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--color-divider)', fontFamily: MONO, fontSize: 11, color: 'var(--color-neutral-500)' }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
            <span>environment.json</span>
            <span className="tnum" style={{ marginLeft: 'auto' }}>{json.length ? `${json.length.toLocaleString('en-US')} chars` : 'empty'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', padding: 'var(--space-4) var(--space-4) var(--space-2) var(--space-4)' }}>
            <span aria-hidden style={{ fontFamily: MONO, color: 'var(--color-accent)', lineHeight: 1.7, fontSize: 13 }}>›</span>
            <textarea
              className="fi-textarea"
              aria-label="Environment JSON"
              value={json}
              onChange={(e) => onJson(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoFocus
              placeholder={'Paste or type JSON, then press Enter…  { "nodes": [ … ], "edges": [ … ] }'}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
            <button className="btn btn-ghost" type="button" onClick={loadSample}>Load sample</button>
            <button className="btn btn-ghost" type="button" onClick={() => fileRef.current?.click()}>Upload .json</button>
            <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} hidden />
            <button className="btn btn-ghost" type="button" onClick={onFormat} disabled={!info.data}>Format</button>
            <button className="btn btn-ghost" type="button" onClick={() => onJson('')}>Clear</button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-neutral-500)' }}>{hint}</span>
            <button className="btn btn-icon btn-primary" type="button" onClick={onRun} disabled={!valid} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden>
                <path d="M205.66 117.66a8 8 0 0 1-11.32 0L136 59.31V216a8 8 0 0 1-16 0V59.31l-58.34 58.35a8 8 0 0 1-11.32-11.32l72-72a8 8 0 0 1 11.32 0l72 72a8 8 0 0 1 0 11.32Z" />
              </svg>
            </button>
          </div>
        </div>
        {sampleError && <div role="alert" style={{ fontSize: 12, color: 'var(--color-err)' }}>{sampleError}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 'var(--space-6)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} aria-live="polite">
            <Kicker>Live check</Kicker>
            {checks.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr)', gap: 'var(--space-3)', alignItems: 'baseline' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: DOT[c.level], display: 'inline-block' }} />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{c.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', overflowWrap: 'anywhere' }}>{c.detail}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <Kicker>Schema</Kicker>
            {SCHEMA.map((f) => (
              <div key={f.key} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--color-divider)' }}>
                <code style={{ fontFamily: MONO, fontSize: 12, color: 'var(--color-accent-300)', whiteSpace: 'nowrap' }}>{f.key}</code>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{f.note}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
