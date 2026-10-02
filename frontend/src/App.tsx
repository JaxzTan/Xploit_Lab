import { useCallback, useEffect, useRef, useState } from 'react'
import { getApi, isMock } from './api/client'
import type { AnalyzeResponse, Scenario, ScenarioSummary, WhatIfResponse } from './api/types'
import { Header } from './components/Header'
import { TabNav, type ViewKey } from './components/TabNav'
import { buildPath, parseRoute } from './lib/route'
import { IdleState } from './components/IdleState'
import { Pipeline, type PipelineItem } from './components/Pipeline'
import { VerdictView } from './components/VerdictView'
import { AttackPathView } from './components/AttackPathView'
import { TimelineView } from './components/TimelineView'
import { ReasoningView } from './components/ReasoningView'
import { EvidenceView } from './components/EvidenceView'
import { RemediationView } from './components/RemediationView'
import { HopDrawer } from './components/HopDrawer'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function pipelineFor(scenario: Scenario | null, analysis: AnalyzeResponse | null): PipelineItem[] {
  if (scenario?.source === 'cached') {
    return [
      { label: 'DEMO_MODE=cached — loading golden_path.json', meta: 'no model call' },
      { label: 'Running exposure engine', meta: 'pure functions' },
    ]
  }
  const v = analysis?.validation
  return [
    { label: 'Calling Gemini with response_schema=AttackPath', meta: 'temperature 0' },
    { label: 'Validating every hop against bank.json', meta: v ? `${v.hops_verified}/${v.hops_total} allowed edges` : 'checking' },
    { label: 'Cross-checking systems_reached with code BFS', meta: v ? (v.bfs_subset ? 'subset ✓' : 'mismatch — BFS wins') : 'checking' },
    { label: 'Running exposure engine', meta: 'pure functions' },
  ]
}

export default function App() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [scenarioId, setScenarioId] = useState<string>('')
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)

  const [view, setView] = useState<ViewKey>('verdict')
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [pendingAnalysis, setPendingAnalysis] = useState<AnalyzeResponse | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [step, setStep] = useState(-1)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [applied, setApplied] = useState<string[]>([])
  const [whatIf, setWhatIf] = useState<WhatIfResponse | null>(null)
  const [whatIfPending, setWhatIfPending] = useState(false)
  const [whatIfError, setWhatIfError] = useState<string | null>(null)

  const [showDenied, setShowDenied] = useState(true)
  const [focus, setFocus] = useState<string | null>(null)

  const runSeq = useRef(0)
  const whatIfSeq = useRef(0)

  // Deep links: /<scenario>/<tab>. A tab in the URL auto-runs the analysis, then opens that tab.
  const initialRoute = useRef(parseRoute(window.location.pathname))
  const pendingView = useRef<ViewKey | null>(initialRoute.current.view ?? null)
  const fromPopState = useRef(false)

  // Scenario list (once, and on retry).
  useEffect(() => {
    let alive = true
    setLoadError(null)
    getApi()
      .then((api) => api.listScenarios())
      .then((list) => {
        if (!alive) return
        setScenarios(list)
        const wanted = initialRoute.current.scenario
        setScenarioId((cur) => cur || (list.some((s) => s.id === wanted) ? wanted! : list[0]?.id || ''))
      })
      .catch((e) => alive && setLoadError(errorText(e)))
    return () => {
      alive = false
    }
  }, [loadNonce])

  // Scenario detail whenever the selection changes.
  useEffect(() => {
    if (!scenarioId) return
    let alive = true
    setScenario(null)
    setLoadError(null)
    getApi()
      .then((api) => api.getScenario(scenarioId))
      .then((sc) => alive && setScenario(sc))
      .catch((e) => alive && setLoadError(errorText(e)))
    return () => {
      alive = false
    }
  }, [scenarioId, loadNonce])

  const resetAnalysis = useCallback(() => {
    runSeq.current++
    whatIfSeq.current++
    setAnalysis(null)
    setPendingAnalysis(null)
    setAnalyzing(false)
    setStep(-1)
    setAnalyzeError(null)
    setApplied([])
    setWhatIf(null)
    setWhatIfPending(false)
    setWhatIfError(null)
    setFocus(null)
    setView('verdict')
  }, [])

  const selectScenario = (id: string) => {
    if (id === scenarioId) return
    pendingView.current = null
    resetAnalysis()
    setScenarioId(id)
  }

  const runAnalysis = useCallback(() => {
    if (!scenario) return
    const seq = ++runSeq.current
    whatIfSeq.current++
    const steps = scenario.source === 'cached' ? 2 : 4
    const interval = scenario.source === 'cached' ? 220 : 480
    setAnalysis(null)
    setPendingAnalysis(null)
    setAnalyzeError(null)
    setApplied([])
    setWhatIf(null)
    setWhatIfError(null)
    setFocus(null)
    setAnalyzing(true)
    setStep(0)

    // Pipeline animation paces the request; the last step waits for the server.
    const started = performance.now()
    const tick = (i: number) => {
      if (seq !== runSeq.current) return
      if (i < steps - 1) {
        setStep(i)
        window.setTimeout(() => tick(i + 1), interval)
      } else {
        setStep(steps - 1)
      }
    }
    window.setTimeout(() => tick(1), interval)

    getApi()
      .then((api) => api.analyze(scenario.id))
      .then((res) => {
        if (seq !== runSeq.current) return
        setPendingAnalysis(res)
        const minDuration = steps * interval
        const wait = Math.max(0, minDuration - (performance.now() - started))
        window.setTimeout(() => {
          if (seq !== runSeq.current) return
          setStep(steps)
          setAnalysis(res)
          setPendingAnalysis(null)
          setAnalyzing(false)
          setStep(-1)
          setView(pendingView.current ?? 'verdict')
          pendingView.current = null
        }, wait)
      })
      .catch((e) => {
        if (seq !== runSeq.current) return
        pendingView.current = null
        setAnalyzeError(errorText(e))
      })
  }, [scenario])

  // Stackable what-if: every toggle re-posts the full change list. No model call.
  const toggleChange = (changeId: string) => {
    if (!scenario) return
    const next = applied.includes(changeId)
      ? applied.filter((c) => c !== changeId)
      : scenario.changes.map((c) => c.id).filter((id) => id === changeId || applied.includes(id))
    setApplied(next)
    setWhatIfError(null)
    const seq = ++whatIfSeq.current
    if (next.length === 0) {
      setWhatIf(null)
      setWhatIfPending(false)
      return
    }
    setWhatIfPending(true)
    getApi()
      .then((api) => api.whatIf(scenario.id, next))
      .then((res) => {
        if (seq !== whatIfSeq.current) return
        setWhatIf(res)
        setWhatIfPending(false)
      })
      .catch((e) => {
        if (seq !== whatIfSeq.current) return
        setWhatIfError(errorText(e))
        setWhatIfPending(false)
      })
  }

  const analyzed = !!analysis && !analyzing

  // Deep link with a tab: run the analysis as soon as the scenario detail arrives.
  useEffect(() => {
    if (scenario && scenario.id === scenarioId && pendingView.current && !analysis && !analyzing) runAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario])

  // State -> URL. Held back while a deep link is still resolving so the requested tab isn't lost.
  useEffect(() => {
    if (!scenarioId || pendingView.current) return
    const path = buildPath(scenarioId, analyzed ? view : null)
    if (path !== window.location.pathname) {
      if (fromPopState.current) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    fromPopState.current = false
  }, [scenarioId, view, analyzed])

  // URL -> state on back/forward.
  useEffect(() => {
    const onPop = () => {
      const route = parseRoute(window.location.pathname)
      fromPopState.current = true
      if (route.scenario && route.scenario !== scenarioId && scenarios.some((s) => s.id === route.scenario)) {
        resetAnalysis()
        pendingView.current = route.view ?? null
        setScenarioId(route.scenario)
      } else if (route.view && analyzed) {
        setView(route.view)
      } else if (route.view && !analyzing) {
        pendingView.current = route.view
        runAnalysis()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [scenarioId, scenarios, analyzed, analyzing, resetAnalysis, runAnalysis])
  const showIdle = !analysis && !analyzing
  const focusDetail = analysis && focus ? analysis.hop_details[focus] : undefined
  const closeDrawer = useCallback(() => setFocus(null), [])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.5 }}>
      <Header
        scenarios={scenarios}
        scenarioId={scenarioId}
        scenarioLabel={scenario?.meta.label ?? scenarios.find((s) => s.id === scenarioId)?.label ?? ''}
        analysis={analysis}
        analyzing={analyzing && !analyzeError}
        canAnalyze={!!scenario}
        onSelect={selectScenario}
        onAnalyze={runAnalysis}
      />
      <TabNav view={view} enabled={analyzed} onChange={setView} />

      <main style={{ padding: 'var(--space-8)', maxWidth: 1280, width: '100%', boxSizing: 'border-box', flex: 1 }}>
        {loadError && !scenario && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-4)', padding: '64px 0 40px' }}>
            <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--color-danger)' }}>API unreachable</div>
            <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-0.02em' }}>Can’t load the scenario.</h1>
            <p style={{ margin: 0, maxWidth: '62ch', color: 'var(--color-neutral-400)' }}>
              {loadError}. Start the backend on <code style={{ color: 'var(--color-accent-300)' }}>localhost:8000</code>
              {isMock ? '' : <>, or run the frontend with <code style={{ color: 'var(--color-accent-300)' }}>VITE_MOCK=1</code></>}.
            </p>
            <button className="btn btn-secondary" type="button" onClick={() => setLoadNonce((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}

        {!loadError && !scenario && (
          <div style={{ padding: '64px 0', color: 'var(--color-neutral-600)', fontSize: 13 }} aria-live="polite">
            Loading scenario…
          </div>
        )}

        {scenario && showIdle && <IdleState scenario={scenario} analyzing={analyzing} onAnalyze={runAnalysis} />}

        {scenario && analyzing && (
          <Pipeline items={pipelineFor(scenario, pendingAnalysis)} step={step} error={analyzeError} onRetry={runAnalysis} />
        )}

        {scenario && analysis && analyzed && (
          <>
            {view === 'verdict' && <VerdictView scenario={scenario} analysis={analysis} />}
            {view === 'path' && (
              <AttackPathView
                scenario={scenario}
                analysis={analysis}
                whatIf={whatIf}
                showDenied={showDenied}
                onToggleDenied={() => setShowDenied((s) => !s)}
                focus={focus}
                onFocus={(id) => setFocus((f) => (f === id ? null : id))}
              />
            )}
            {view === 'timeline' && <TimelineView analysis={analysis} />}
            {view === 'reasoning' && <ReasoningView analysis={analysis} />}
            {view === 'why' && <EvidenceView scenario={scenario} analysis={analysis} />}
            {view === 'whatif' && (
              <RemediationView
                scenario={scenario}
                baseline={analysis.verdict}
                applied={applied}
                whatIf={whatIf}
                pending={whatIfPending}
                error={whatIfError}
                onToggle={toggleChange}
              />
            )}
          </>
        )}
      </main>

      <footer style={{ padding: 'var(--space-6) var(--space-8) var(--space-8)', borderTop: '1px solid var(--color-divider)', fontSize: 12, color: 'var(--color-neutral-600)' }}>
        Synthetic data · Regulatory flag is a simplified rule, not legal advice
      </footer>

      {focus && focusDetail && analysis && (
        <HopDrawer edgeId={focus} edge={scenario?.edges.find((e) => e.edge_id === focus)} detail={focusDetail} onClose={closeDrawer} />
      )}
    </div>
  )
}
