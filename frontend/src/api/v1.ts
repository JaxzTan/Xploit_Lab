import type { Issue, RunEvent } from './types'

/** A non-2xx reply. `issues` carries the server's {path, msg} list on 413/422. */
export class ApiError extends Error {
  status: number
  issues: Issue[]
  constructor(status: number, message: string, issues: Issue[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

async function failure(res: Response): Promise<ApiError> {
  let issues: Issue[] = []
  try {
    const body = await res.json()
    issues = body?.detail?.errors ?? []
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, `${res.status} ${res.statusText}`.trim(), issues)
}

export async function fetchSample(): Promise<unknown> {
  const res = await fetch('/v1/sample', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw await failure(res)
  return res.json()
}

/**
 * POST /v1/analyze and hand each SSE frame to `onEvent` as it arrives.
 * fetch + ReadableStream rather than EventSource, because the body is a POST (TRD_V2 §3).
 */
export async function streamAnalyze(
  body: string,
  onEvent: (e: RunEvent) => void,
  signal: AbortSignal,
  mode: 'live' | 'cached' = 'live',
): Promise<void> {
  const res = await fetch(`/v1/analyze?mode=${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body,
    signal,
  })
  if (!res.ok || !res.body) throw await failure(res)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      let event = ''
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7)
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (event && data) onEvent({ event, data: JSON.parse(data) } as RunEvent)
    }
  }
}
