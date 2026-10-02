import type { ViewKey } from '../components/TabNav'

// URL shape: /<scenario-id>[/<tab-slug>], e.g. /lion/remediation
const TAB_SLUGS: Record<ViewKey, string> = {
  verdict: 'verdict',
  path: 'attack-path',
  timeline: 'timeline',
  reasoning: 'ai-reasoning',
  why: 'evidence',
  whatif: 'remediation',
}

const SLUG_TO_VIEW = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([view, slug]) => [slug, view as ViewKey]),
) as Record<string, ViewKey>

export interface Route {
  scenario?: string
  view?: ViewKey
}

export function parseRoute(pathname: string): Route {
  const [scenario, slug] = pathname.split('/').filter(Boolean)
  return { scenario, view: slug ? SLUG_TO_VIEW[slug] : undefined }
}

export function buildPath(scenario: string, view: ViewKey | null): string {
  return view ? `/${scenario}/${TAB_SLUGS[view]}` : `/${scenario}`
}
