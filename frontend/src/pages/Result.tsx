import type { AnalysisResult } from '../api/types'
import { navigate } from '../lib/router'
import { VerdictTab } from './result/VerdictTab'
import { PathTab } from './result/PathTab'
import { TimelineTab } from './result/TimelineTab'
import { ReasoningTab } from './result/ReasoningTab'
import { WhyTab } from './result/WhyTab'
import { WhatIfTab } from './result/WhatIfTab'

export const TABS = [
  { slug: 'verdict', label: 'Verdict' },
  { slug: 'attack-path', label: 'Attack path' },
  { slug: 'timeline', label: 'Timeline' },
  { slug: 'ai-reasoning', label: 'AI reasoning' },
  { slug: 'show-me-why', label: 'Show me why' },
  { slug: 'what-if', label: 'What-if' },
] as const

export type TabSlug = (typeof TABS)[number]['slug']

export function tabFromPath(path: string): TabSlug {
  const slug = path.split('/')[2]
  return TABS.some((t) => t.slug === slug) ? (slug as TabSlug) : 'verdict'
}

export function Result({ result, tab }: { result: AnalysisResult; tab: TabSlug }) {
  return (
    <>
      <nav role="tablist" aria-label="Report" style={{ display: 'flex', gap: 'var(--space-1)', padding: '0 var(--space-8)', borderBottom: '1px solid var(--color-divider)', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.slug}
            role="tab"
            type="button"
            className="fapi-tab"
            aria-selected={tab === t.slug}
            onClick={() => navigate(t.slug === 'verdict' ? '/result' : `/result/${t.slug}`)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main key={tab} className="fapi-in" style={{ padding: 'var(--space-8)', maxWidth: 1280, width: '100%' }}>
        {tab === 'verdict' && <VerdictTab r={result} />}
        {tab === 'attack-path' && <PathTab r={result} />}
        {tab === 'timeline' && <TimelineTab r={result} />}
        {tab === 'ai-reasoning' && <ReasoningTab r={result} />}
        {tab === 'show-me-why' && <WhyTab r={result} />}
        {tab === 'what-if' && <WhatIfTab r={result} />}
      </main>
    </>
  )
}
