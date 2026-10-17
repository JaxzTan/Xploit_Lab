/** USD with thousands separators, no decimals. Formatting only — values come from the API. */
export const usd = (n: number): string => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US')

export const fixed2 = (n: number | null | undefined): string => (n == null ? '—' : n.toFixed(2))

/** Probability in formulas: up to 3 decimals, no trailing zeros (design `pr()`). */
export const pr = (p: number): string => String(Math.round(p * 1000) / 1000)

/** Hours without a trailing ".0". */
export const hours = (h: number): string => `${Math.round(h * 10) / 10}h`

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
