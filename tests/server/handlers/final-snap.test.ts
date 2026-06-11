import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameState } from '@/types/shared'

const getRoom = vi.fn()
const setRoom = vi.fn()
vi.mock('@/server/lobby', () => ({ lobby: {
  getRoom: (...a: unknown[]) => getRoom(...a),
  setRoom: (...a: unknown[]) => setRoom(...a),
  withRoomLock: (_id: string, fn: () => unknown) => fn(),
} }))

import { scheduleRoundFinalize, broadcastAfterAction, broadcastSnapExtend } from '@/server/handlers/final-snap'

type Emit = { socketId: string; event: string; payload: any }
function fakeIo(): { io: any; emits: Emit[] } {
  const emits: Emit[] = []
  const io = { to: (socketId: string) => ({ emit: (event: string, payload: any) => emits.push({ socketId, event, payload }) }) }
  return { io, emits }
}
function finalSnapState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [
      { id: 'p1', socketId: 's1', name: 'A', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: 's2', name: 'B', hand: [{ id: 'Q-h', rank: 'Q', suit: 'hearts' }], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ],
    pendingJoins: [], deck: [], discard: [], turn: 0, phase: 'final-snap',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null,
    snapWindow: { openedAt: 1, durationMs: 2500, discardedCardId: 'x' },
    log: [], createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
    roundTurnCount: 1, roundNumber: 1, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

beforeEach(() => { vi.useFakeTimers(); getRoom.mockReset(); setRoom.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('broadcastAfterAction', () => {
  it('em final-snap faz broadcast e agenda o finalize', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    broadcastAfterAction(io, finalSnapState(), 50)
    expect(emits.length).toBe(2)
    expect(emits[0]!.payload.state.phase).toBe('final-snap')
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).toHaveBeenCalled()
    const persisted = setRoom.mock.calls[0]![0] as GameState
    expect(persisted.phase).toBe('round-end')
  })
})

describe('scheduleRoundFinalize', () => {
  it('finaliza no deadline e faz broadcast do round-end', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).toHaveBeenCalled()
    expect(emits.some(e => e.payload.state.phase === 'round-end')).toBe(true)
  })

  it('ignora se a sala saiu de final-snap (guard)', async () => {
    const { io } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState({ phase: 'round-end' }))
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).not.toHaveBeenCalled()
  })

  it('reagendar limpa o timer anterior (finaliza uma vez)', async () => {
    const { io } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    scheduleRoundFinalize(io, 'r1', 1, 50)
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).toHaveBeenCalledTimes(1)
  })

  it('ignora se a sala sumiu', async () => {
    const { io } = fakeIo()
    getRoom.mockResolvedValue(undefined)
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).not.toHaveBeenCalled()
  })
})

describe('broadcastSnapExtend', () => {
  it('faz broadcast e reagenda o finalize com FINAL_SNAP_EXTEND_MS', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    broadcastSnapExtend(io, finalSnapState())
    expect(emits.length).toBe(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(setRoom).toHaveBeenCalled()
  })
})
