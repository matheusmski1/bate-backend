import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameState } from '@/types/shared'
import { practiceRound, setHand, card } from './fixtures'
import { seedFromInitialPeek } from '@/server/game/bot/belief'

const rooms = new Map<string, GameState>()
const botMems = new Map<string, unknown>()
vi.mock('@/server/lobby', () => ({ lobby: {
  getRoom: async (id: string) => rooms.get(id),
  setRoom: async (s: GameState) => { rooms.set(s.roomId, s) },
  withRoomLock: async (_id: string, fn: () => unknown) => fn(),
  getBotMemory: async (roomId: string, botId: string) => botMems.get(`${roomId}:${botId}`),
  setBotMemory: async (roomId: string, botId: string, mem: unknown) => { botMems.set(`${roomId}:${botId}`, mem) },
  addPeekConfirmation: async (_r: string, _p: string) => 99,
  clearPeekConfirmations: async () => {},
} }))
vi.mock('@/server/handlers/broadcast', () => ({ broadcastRoom: () => {} }))

import { scheduleBotActions } from '@/server/game/bot/driver'

function fakeIo(connectedSocketIds: string[]) {
  return { sockets: { sockets: { has: (id: string) => connectedSocketIds.includes(id) } }, to: () => ({ emit: () => {} }) } as never
}

beforeEach(() => { vi.useFakeTimers(); rooms.clear(); botMems.clear() })
afterEach(() => { vi.useRealTimers() })

describe('scheduleBotActions', () => {
  it('nao age quando nao ha humano conectado', async () => {
    const state = { ...practiceRound(['hard']), turn: 1 }
    rooms.set(state.roomId, state)
    scheduleBotActions(fakeIo([]), state.roomId)
    await vi.advanceTimersByTimeAsync(5000)
    expect(rooms.get(state.roomId)!.roundTurnCount).toBe(state.roundTurnCount)
  })

  it('executa o turno do bot quando e a vez dele e ha humano', async () => {
    let state = { ...practiceRound(['hard']), turn: 1 }
    state = { ...state, players: state.players.map(p => (p.isBot ? p : { ...p, socketId: 'sock-human' })) }
    const botId = state.players[1]!.id
    state = setHand(state, botId, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    rooms.set(state.roomId, state)
    botMems.set(`${state.roomId}:${botId}`, seedFromInitialPeek(state, botId, 'hard'))
    scheduleBotActions(fakeIo(['sock-human']), state.roomId)
    await vi.advanceTimersByTimeAsync(3000)
    const after = rooms.get(state.roomId)!
    expect(after.log.some(l => l.actorId === botId)).toBe(true)
  })
})
