import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameState } from '@/types/shared'

const getRoom = vi.fn()
vi.mock('@/server/lobby', () => ({ lobby: { getRoom: (...a: unknown[]) => getRoom(...a) } }))

import { scheduleEndReveal, broadcastEndAware } from '@/server/handlers/end-reveal'

type Emit = { socketId: string; event: string; payload: any }

function fakeIo(): { io: any; emits: Emit[] } {
  const emits: Emit[] = []
  const io = { to: (socketId: string) => ({ emit: (event: string, payload: any) => emits.push({ socketId, event, payload }) }) }
  return { io, emits }
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [
      { id: 'p1', socketId: 's1', name: 'A', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: 's2', name: 'B', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ],
    pendingJoins: [], deck: [], discard: [], turn: 0, phase: 'round-end',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null, snapWindow: null,
    log: [{ timestamp: 1, type: 'discard', actorId: 'p1' }],
    createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
    roundTurnCount: 1, roundNumber: 1, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

beforeEach(() => { vi.useFakeTimers(); getRoom.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('broadcastEndAware', () => {
  it('em transição de tabuleiro→fim, manda primeiro o snapshot de tabuleiro', () => {
    const { io, emits } = fakeIo()
    broadcastEndAware(io, 'bate-called', state({ phase: 'round-end' }), 2500)
    const phases = emits.map(e => e.payload.state.phase)
    expect(phases.every(p => p === 'bate-called')).toBe(true)
    expect(emits.length).toBe(2)
  })

  it('sem transição de fim, manda o estado direto (comportamento atual)', () => {
    const { io, emits } = fakeIo()
    broadcastEndAware(io, 'playing', state({ phase: 'playing' }), 2500)
    expect(emits.every(e => e.payload.state.phase === 'playing')).toBe(true)
  })
})

describe('scheduleEndReveal', () => {
  it('re-transmite o estado de fim depois do delay quando fase/round batem', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(state({ phase: 'round-end', roundNumber: 1 }))
    scheduleEndReveal(io, 'r1', 'round-end', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(emits.length).toBe(2)
    expect(emits[0]?.payload.state.phase).toBe('round-end')
  })

  it('não transmite se a sala sumiu', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(undefined)
    scheduleEndReveal(io, 'r1', 'round-end', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(emits.length).toBe(0)
  })

  it('não transmite se a rodada já avançou (guard)', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(state({ phase: 'playing', roundNumber: 2 }))
    scheduleEndReveal(io, 'r1', 'round-end', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(emits.length).toBe(0)
  })
})
