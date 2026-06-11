export class Metrics {
  private samples = new Map<string, number[]>()
  private errorCount = 0
  private eventCount = 0

  record(label: string, ms: number): void {
    const arr = this.samples.get(label) ?? []
    arr.push(ms)
    this.samples.set(label, arr)
    this.eventCount++
  }

  recordError(): void {
    this.errorCount++
  }

  values(label: string): number[] {
    return this.samples.get(label) ?? []
  }

  get errors(): number {
    return this.errorCount
  }

  get events(): number {
    return this.eventCount
  }

  reset(): void {
    this.samples.clear()
    this.errorCount = 0
    this.eventCount = 0
  }
}
