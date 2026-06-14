import { describe, it, expect } from 'vitest'
import { sweepRooms } from '@/server/game/cleanup'
import { createEmptyRoom } from '@/server/game/state'
import type { GameState, RoomSummary } from '@/types/shared'

const NOW = 1_700_000_000_000
const IDLE_LIMIT = 5 * 60 * 1000

const summaryOf = (roomId: string): RoomSummary => ({
  roomId,
  name: 'sala',
  playerCount: 1,
  maxPlayers: 4,
  phase: 'waiting',
  spectatorCount: 0,
  pendingJoinCount: 0,
})

function buildRoom(roomId: string, overrides: Partial<GameState> = {}): GameState {
  const base = createEmptyRoom({ roomId, name: 'sala', maxPlayers: 4, hostId: 'host', hostName: 'Host' })
  return {
    ...base,
    players: base.players.map(p => ({ ...p, socketId: 'sock-host' })),
    createdAt: NOW - 10 * 60 * 1000,
    log: [],
    ...overrides,
  }
}

const everyoneConnected = () => true
const noneConnected = () => false

describe('sweepRooms', () => {
  it('remove o summary órfão quando a sala real não existe mais (room key expirou via TTL)', async () => {
    const removed: string[] = []
    const result = await sweepRooms({
      listRooms: async () => [summaryOf('FE3BCF')],
      getRoom: async () => undefined,
      removeRoom: async id => {
        removed.push(id)
      },
      now: NOW,
      idleLimitMs: IDLE_LIMIT,
      isConnected: noneConnected,
    })

    expect(removed).toEqual(['FE3BCF'])
    expect(result.orphaned).toEqual(['FE3BCF'])
    expect(result.expired).toEqual([])
  })

  it('expira sala ociosa sem ninguém conectado e notifica antes de remover', async () => {
    const removed: string[] = []
    const notified: string[] = []
    const result = await sweepRooms({
      listRooms: async () => [summaryOf('IDLE01')],
      getRoom: async () => buildRoom('IDLE01'),
      removeRoom: async id => {
        removed.push(id)
      },
      now: NOW,
      idleLimitMs: IDLE_LIMIT,
      isConnected: noneConnected,
      onIdleExpire: room => notified.push(room.roomId),
    })

    expect(notified).toEqual(['IDLE01'])
    expect(removed).toEqual(['IDLE01'])
    expect(result.expired).toEqual(['IDLE01'])
    expect(result.orphaned).toEqual([])
  })

  it('não remove sala viva com jogador conectado', async () => {
    const removed: string[] = []
    const result = await sweepRooms({
      listRooms: async () => [summaryOf('LIVE01')],
      getRoom: async () => buildRoom('LIVE01'),
      removeRoom: async id => {
        removed.push(id)
      },
      now: NOW,
      idleLimitMs: IDLE_LIMIT,
      isConnected: everyoneConnected,
    })

    expect(removed).toEqual([])
    expect(result.expired).toEqual([])
    expect(result.orphaned).toEqual([])
  })

  it('separa órfãos de salas vivas no mesmo tick', async () => {
    const rooms: Record<string, GameState | undefined> = {
      LIVE01: buildRoom('LIVE01'),
      GHOST1: undefined,
    }
    const removed: string[] = []
    const result = await sweepRooms({
      listRooms: async () => [summaryOf('LIVE01'), summaryOf('GHOST1')],
      getRoom: async id => rooms[id],
      removeRoom: async id => {
        removed.push(id)
      },
      now: NOW,
      idleLimitMs: IDLE_LIMIT,
      isConnected: everyoneConnected,
    })

    expect(removed).toEqual(['GHOST1'])
    expect(result.orphaned).toEqual(['GHOST1'])
    expect(result.expired).toEqual([])
    expect(result.scanned).toBe(2)
  })
})
