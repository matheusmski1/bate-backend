export type Summary = {
  count: number
  p50: number
  p95: number
  p99: number
  max: number
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))]!
}

export function summarize(values: number[]): Summary {
  return {
    count: values.length,
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
    max: round(values.length ? Math.max(...values) : 0),
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
