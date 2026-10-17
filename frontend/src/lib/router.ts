import { useEffect, useState } from 'react'

// Three routes (TRD_V2 §2): / console, /run processing, /result[/<tab>] report.

export function navigate(path: string, replace = false) {
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const on = () => setPath(window.location.pathname)
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  return path
}

/** sessionStorage that never throws (private windows, blocked storage). */
export const session = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      window.sessionStorage.setItem(key, value)
    } catch {
      /* storage unavailable or full: the app still works for this tab */
    }
  },
}
