import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setStorage } from '@/server/storage'
import { MemoryStorage } from '@/server/storage/memory'
import { lobby } from '@/server/lobby'
import { registerGameHandlers } from '@/server/handlers/game-handlers'
import { createEmptyRoom, startRound } from '@/server/game/state'
import type { GameState, EffectType } from '@/types/shared'

vi.mock('@/server/handlers/broadcast', () => ({ broadcastRoom: () => {} }))
vi.mock('@/server/handlers/final-snap', () => ({
  broadcastAfterAction: () => {},
  broadcastSnapExtend: () => {},
  FINAL_SNAP_EXTEND_MS: 2000,
}))

const HUMAN = '11111111-1111-4111-8111-111111111111'
const BOT = 'bot:ABC123:0'

function fakeSocket(playerId: string) {
  const handlers = new Map<string, (raw: unknown, ack: (r: unknown) => void) => void>()
  return {
    socket: { data: { playerId }, on: (e: string, fn: never) => handlers.set(e, fn as never), join: () => {}, leave: () => {}, id: 's1' } as never,
    emit: (e: string, raw: unknown) => new Promise<any>(res => handlers.get(e)!(raw, res)),
  }
}
const io = { to: () => ({ emit: () => {} }), sockets: { sockets: { has: () => true } } } as never

function roomWithBotEffect(effectType: EffectType): GameState {
  const empty = createEmptyRoom({ roomId: 'ABC123', name: 'Treino', hostId: HUMAN, hostName: 'Eu', maxPlayers: 2 })
  empty.players.push({
    id: BOT, socketId: null, name: 'Batinho', hand: [], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
    isBot: true, botLevel: 'medium',
  })
  const round = startRound(empty)
  return { ...round, phase: 'effect-pending', pendingEffect: { type: effectType, playerId: HUMAN } }
}

beforeEach(() => { setStorage(new MemoryStorage()) })

describe('game:effect-target contra bot (humano joga carta de acao mirando um bot)', () => {
  it('ESPIADINHA (peek-other) mirando um bot resolve e revela a carta', async () => {
    await lobby.setRoom(roomWithBotEffect('peek-other'))
    const { socket, emit } = fakeSocket(HUMAN)
    registerGameHandlers(io, socket)
    const res = await emit('game:effect-target', {
      roomId: 'ABC123', playerId: HUMAN, targetPlayerId: BOT, targetCardIndex: 0,
    })
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.payload.revealed[0].ownerId).toBe(BOT)
  })

  it('TROCA (swap) mirando um bot resolve sem INVALID_PAYLOAD', async () => {
    await lobby.setRoom(roomWithBotEffect('swap'))
    const { socket, emit } = fakeSocket(HUMAN)
    registerGameHandlers(io, socket)
    const res = await emit('game:effect-target', {
      roomId: 'ABC123', playerId: HUMAN, targetPlayerId: BOT, targetCardIndex: 0, myCardIndex: 0,
    })
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
  })
})
