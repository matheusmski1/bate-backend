import { gameEvents } from './events'

const RING_SIZE = 512

type EventStat = { count: number; errors: number; samples: number[] }

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]!
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

class Metrics {
  private startedAt = Date.now()
  private actions = new Map<string, EventStat>()
  private broadcasts = 0
  private recipients = 0
  private roundDurations: number[] = []
  private roundsCompleted = 0
  private lastRoundByRoom = new Map<string, number>()

  constructor() {
    gameEvents.onAction(e => this.recordAction(e.event, e.ms, e.ok))
    gameEvents.onBroadcast(e => {
      this.broadcasts++
      this.recipients += e.recipients
      this.trackRound(e.roomId, e.roundNumber, e.roundStartedAt, e.phase)
    })
  }

  private recordAction(event: string, ms: number, ok: boolean): void {
    let stat = this.actions.get(event)
    if (!stat) {
      stat = { count: 0, errors: 0, samples: [] }
      this.actions.set(event, stat)
    }
    stat.count++
    if (!ok) stat.errors++
    stat.samples.push(ms)
    if (stat.samples.length > RING_SIZE) stat.samples.shift()
  }

  private trackRound(roomId: string, roundNumber: number, roundStartedAt: number | null, phase: string): void {
    if (phase !== 'round-end' && phase !== 'match-end') return
    if (roundStartedAt === null || roundNumber <= 0) return
    if (this.lastRoundByRoom.get(roomId) === roundNumber) return
    this.lastRoundByRoom.set(roomId, roundNumber)
    this.roundsCompleted++
    this.roundDurations.push(Date.now() - roundStartedAt)
    if (this.roundDurations.length > RING_SIZE) this.roundDurations.shift()
  }

  snapshot() {
    const events: Record<string, { count: number; errors: number; p50: number; p95: number; max: number }> = {}
    for (const [name, stat] of this.actions) {
      events[name] = {
        count: stat.count,
        errors: stat.errors,
        p50: Math.round(percentile(stat.samples, 50) * 100) / 100,
        p95: Math.round(percentile(stat.samples, 95) * 100) / 100,
        max: stat.samples.length ? Math.round(Math.max(...stat.samples) * 100) / 100 : 0,
      }
    }
    const avgMs = this.roundDurations.length
      ? this.roundDurations.reduce((a, b) => a + b, 0) / this.roundDurations.length
      : 0
    return {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      broadcasts: this.broadcasts,
      recipients: this.recipients,
      rounds: {
        completed: this.roundsCompleted,
        avgSec: round1(avgMs / 1000),
        p95Sec: round1(percentile(this.roundDurations, 95) / 1000),
      },
      events,
    }
  }
}

export const metrics = new Metrics()
