/** USD with thousands separators, no decimals. Formatting only — values come from the API. */
export const usd = (n: number): string => '$' + Math.round(n).toLocaleString('en-US')

export const fixed2 = (n: number | null | undefined): string => (n == null ? '—' : n.toFixed(2))
