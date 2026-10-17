import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchSample, streamAnalyze } from './api/v1'
import type { AnalysisResult, Issue, RunEvent } from './api/types'
import { Shell } from './components/Shell'
import { inspect } from './lib/inspect'
import { navigate, session, usePath } from './lib/router'
import { Console } from './pages/Console'
import { Processing } from './pages/Processing'
import { Result, tabFromPath } from './pages/Result'

export interface RunState {
  seq: number
  json: string
  events: RunEvent[]
  status: 'streaming' | 'done' | 'error'
  error?: string
  result?: AnalysisResult
}

const JSON_KEY = 'fapi.json' // last input (TR-1)
const RUN_KEY = 'fapi.run' // last finished run, so /result survives a refresh

const SOURCE_LABEL = { live: 'source: live', cached: 'source: cached', engine_only: 'source: engine only' } as const

function restoreRun(): RunState | null {
  try {
    const saved = session.get(RUN_KEY)
    return saved ? (JSON.parse(saved) as RunState) : null
  } catch {
    return null
  }
}

export default function App() {
  const path = usePath()
  const route = path === '/run' ? 'run' : path.startsWith('/result') ? 'result' : 'console'
  const [json, setJsonState] = useState(() => session.get(JSON_KEY) ?? '')
  const [serverIssues, setServerIssues] = useState<Issue[]>([])
  const [run, setRun] = useState<RunState | null>(restoreRun)
  const abort = useRef<AbortController | null>(null)
  const seq = useRef(run?.seq ?? 0)

  const setJson = (v: string) => {
    setJsonState(v)
    setServerIssues([])
    session.set(JSON_KEY, v)
  }

  const startRun = useCallback((body: string) => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    const id = ++seq.current
    const update = (fn: (r: RunState) => RunState) => setRun((r) => (r && r.seq === id ? fn(r) : r))
    setRun({ seq: id, json: body, events: [], status: 'streaming' })

    streamAnalyze(body, (ev) => update((r) => ({ ...r, events: [...r.events, ev], result: ev.event === 'result' ? ev.data : r.result })), ac.signal)
      .then(() => {
        if (!ac.signal.aborted) update((r) => (r.result ? { ...r, status: 'done' } : { ...r, status: 'error', error: 'the stream ended without a result' }))
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        if (e instanceof ApiError && e.issues.length) {
          // The server's schema lint disagrees with the live check: back to the console with its errors.
          setServerIssues(e.issues)
          setRun(null)
          navigate('/', true)
          return
        }
        update((r) => ({ ...r, status: 'error', error: e instanceof Error ? e.message : String(e) }))
      })
  }, [])

  useEffect(() => () => abort.current?.abort(), [])

  // First visit in this tab: prefill the composer with the sample (TR-1). A cleared box stays empty.
  useEffect(() => {
    if (session.get(JSON_KEY) !== null) return
    fetchSample()
      .then((s) => setJsonState((cur) => cur || JSON.stringify(s, null, 2)))
      .catch(() => {
        /* the Load sample button still works and reports its own error */
      })
  }, [])

  useEffect(() => {
    if (run?.status === 'done') session.set(RUN_KEY, JSON.stringify(run))
  }, [run])

  // Guard deep links: /run needs an input, /result needs a finished run.
  useEffect(() => {
    if (route === 'run' && !run) {
      if (inspect(json).valid) startRun(json)
      else navigate('/', true)
    }
    if (route === 'result' && !run?.result) navigate(run ? '/run' : '/', true)
  }, [route, run, json, startRun])

  useEffect(() => {
    document.title = route === 'result' ? 'FAPI · Verdict' : route === 'run' ? 'FAPI · Processing' : 'FAPI · Key in JSON'
  }, [route])

  const go = () => {
    if (!inspect(json).valid) return
    setServerIssues([])
    startRun(json)
    navigate('/run')
  }
  const back = () => {
    abort.current?.abort()
    setRun(null)
    navigate('/')
  }
  const rerun = () => {
    if (!run) return
    startRun(run.json)
    navigate('/run')
  }

  if (route === 'result' && run?.result) {
    const r = run.result
    return (
      <Shell
        endpoint={`POST /v1/analyze · run ${r.run_id}`}
        right={
          <>
            <button className="btn btn-ghost" type="button" onClick={() => navigate('/')}>Key in JSON</button>
            <span className="tag tag-outline tnum">{r.scenario_label}</span>
            <span className="tag tag-neutral">{SOURCE_LABEL[r.source]}</span>
            <button className="btn btn-primary" type="button" onClick={rerun}>Re-run analysis</button>
          </>
        }
      >
        <Result result={r} tab={tabFromPath(path)} />
      </Shell>
    )
  }

  if (route === 'run' && run) {
    return (
      <Shell endpoint="POST /v1/analyze" right={<span className="tag tag-outline">2 / 2 · Processing</span>}>
        <Processing key={run.seq} run={run} onBack={back} onRetry={rerun} onOpen={() => navigate('/result')} />
      </Shell>
    )
  }

  return (
    <Shell endpoint="POST /v1/analyze" right={<span className="tag tag-outline">1 / 2 · Prompt</span>}>
      <Console json={json} onJson={setJson} onRun={go} serverIssues={serverIssues} />
    </Shell>
  )
}
