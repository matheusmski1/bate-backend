import { describe, it, expect } from 'vitest'
import { gameEvents } from '@/server/events'
import { metrics } from '@/server/metrics'

describe('metrics', () => {
  it('agrega contagem, erros e percentis por evento de dominio', () => {
    gameEvents.emitAction({ event: 'game:draw', roomId: 'R', playerId: 'p', ms: 10, ok: true })
    gameEvents.emitAction({ event: 'game:draw', roomId: 'R', playerId: 'p', ms: 30, ok: false })
    gameEvents.emitBroadcast({ roomId: 'R', phase: 'playing', recipients: 4, roundNumber: 1, roundStartedAt: Date.now() })

    const snap = metrics.snapshot()
    expect(snap.events['game:draw']?.count).toBe(2)
    expect(snap.events['game:draw']?.errors).toBe(1)
    expect(snap.events['game:draw']?.max).toBe(30)
    expect(snap.broadcasts).toBeGreaterThanOrEqual(1)
    expect(snap.recipients).toBeGreaterThanOrEqual(4)
  })
})
