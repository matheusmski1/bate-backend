import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setStorage } from '@/server/storage'
import { MemoryStorage } from '@/server/storage/memory'
import { lobby } from '@/server/lobby'
import { registerGameHandlers } from '@/server/handlers/game-handlers'
import { createEmptyRoom, startRound } from '@/server/game/state'
import type { GameState } from '@/types/shared'

vi.mock('@/server/handlers/broadcast', () => ({ broadcastRoom: () => {} }))
vi.mock('@/server/handlers/final-snap', () => ({
  broadcastAfterAction: () => {},
  broadcastSnapExtend: () => {},
  FINAL_SNAP_EXTEND_MS: 2000,
}))

const HUMAN_ID = '11111111-1111-4111-8111-111111111111'
const BOT_ID = 'bot:ABC123:0'
const ROOM_ID = 'ABC123'

function fakeSocket(playerId: string) {
  const handlers = new Map<string, (raw: unknown, ack: (r: unknown) => void) => void>()
  return {
    socket: { data: { playerId }, on: (e: string, fn: never) => handlers.set(e, fn as never), join: () => {}, leave: () => {}, id: 's1' } as never,
    emit: (e: string, raw: unknown) => new Promise<any>(res => handlers.get(e)!(raw, res)),
  }
}
const io = { to: () => ({ emit: () => {} }), sockets: { sockets: { has: () => true } } } as never

function buildPlayingRoom(): GameState {
  const empty = createEmptyRoom({ roomId: ROOM_ID, name: 'Treino', hostId: HUMAN_ID, hostName: 'Eu', maxPlayers: 2 })
  empty.players.push({
    id: BOT_ID, socketId: null, name: 'Batinho', hand: [], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
    isBot: true, botLevel: 'medium',
  })
  const round = startRound(empty)
  const humanIdx = round.players.findIndex(p => p.id === HUMAN_ID)
  return { ...round, phase: 'playing', turn: humanIdx }
}

beforeEach(() => { setStorage(new MemoryStorage()) })

describe('handlers humano vs bot — ações básicas', () => {
  it('game:snap — humano snapa carta com rank igual ao topo do descarte sem erro', async () => {
    const base = buildPlayingRoom()
    const humanIdx = base.players.findIndex(p => p.id === HUMAN_ID)
    const human = base.players[humanIdx]!
    const topCard = { id: 'snap-top', rank: 'A' as const, suit: 'hearts' as const }
    const snapCard = { ...human.hand[0]!, rank: 'A' as const }
    const players = base.players.map((p, i) =>
      i === humanIdx ? { ...p, hand: [snapCard, ...p.hand.slice(1)] } : p,
    )
    const room: GameState = { ...base, discard: [topCard], players }
    await lobby.setRoom(room)
    const { socket, emit } = fakeSocket(HUMAN_ID)
    registerGameHandlers(io, socket)
    const res = await emit('game:snap', { roomId: ROOM_ID, playerId: HUMAN_ID, handIndex: 0 }) as any
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
  })

  it('game:bate — humano chama bate no seu turno em fase playing sem erro', async () => {
    const room = buildPlayingRoom()
    await lobby.setRoom(room)
    const { socket, emit } = fakeSocket(HUMAN_ID)
    registerGameHandlers(io, socket)
    const res = await emit('game:bate', { roomId: ROOM_ID, playerId: HUMAN_ID }) as any
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
  })

  it('game:keep-or-discard — humano descarta carta comprada sem erro', async () => {
    const room = buildPlayingRoom()
    await lobby.setRoom(room)
    const drawnCard = { id: 'drawn-1', rank: '5' as const, suit: 'clubs' as const }
    await lobby.setDrawnCard(HUMAN_ID, { roomId: ROOM_ID, card: drawnCard })
    const { socket, emit } = fakeSocket(HUMAN_ID)
    registerGameHandlers(io, socket)
    const res = await emit('game:keep-or-discard', {
      roomId: ROOM_ID, playerId: HUMAN_ID, action: 'discard',
    }) as any
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
  })

  it('game:effect-target (peek-own) — humano mira em si mesmo e resolve sem erro', async () => {
    const base = buildPlayingRoom()
    const humanIdx = base.players.findIndex(p => p.id === HUMAN_ID)
    const room: GameState = {
      ...base,
      phase: 'effect-pending',
      pendingEffect: { type: 'peek-own', playerId: HUMAN_ID },
      turn: humanIdx,
    }
    await lobby.setRoom(room)
    const { socket, emit } = fakeSocket(HUMAN_ID)
    registerGameHandlers(io, socket)
    const res = await emit('game:effect-target', {
      roomId: ROOM_ID,
      playerId: HUMAN_ID,
      targetPlayerId: HUMAN_ID,
      targetCardIndex: 0,
    }) as any
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
  })
})
