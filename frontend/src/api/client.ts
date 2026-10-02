import type { AnalyzeResponse, Scenario, ScenarioSummary, WhatIfResponse } from './types'

export interface FapiApi {
  listScenarios(): Promise<ScenarioSummary[]>
  getScenario(id: string): Promise<Scenario>
  analyze(scenarioId: string): Promise<AnalyzeResponse>
  whatIf(scenarioId: string, changeIds: string[]): Promise<WhatIfResponse>
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body && typeof body.detail === 'string') detail = body.detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${res.status} ${detail}`.trim())
  }
  return (await res.json()) as T
}

const httpApi: FapiApi = {
  listScenarios: () => request<ScenarioSummary[]>('/api/scenarios'),
  getScenario: (id) => request<Scenario>(`/api/scenarios/${encodeURIComponent(id)}`),
  analyze: (scenarioId) =>
    request<AnalyzeResponse>('/api/analyze', { method: 'POST', body: JSON.stringify({ scenario_id: scenarioId }) }),
  whatIf: (scenarioId, changeIds) =>
    request<WhatIfResponse>('/api/what-if', {
      method: 'POST',
      body: JSON.stringify({ scenario_id: scenarioId, change_ids: changeIds }),
    }),
}

export const isMock = import.meta.env.VITE_MOCK === '1'

let apiPromise: Promise<FapiApi> | null = null

/** Resolves the real HTTP client, or the in-browser mock when VITE_MOCK=1. */
export function getApi(): Promise<FapiApi> {
  if (!apiPromise) {
    apiPromise = isMock ? import('./mock').then((m) => m.mockApi) : Promise.resolve(httpApi)
  }
  return apiPromise
}
