import { describe, it, expect } from 'vitest'
import { createEmptyRoom, shouldExpireIdleRoom } from '@/server/game/state'
import type { GameState } from '@/types/shared'

const IDLE_LIMIT = 5 * 60 * 1000
const NOW = 1_700_000_000_000

function buildRoom(overrides: Partial<GameState> = {}): GameState {
  const base = createEmptyRoom({
    roomId: 'TEST01',
    name: 'sala',
    maxPlayers: 4,
    hostId: 'host',
    hostName: 'Host',
  })
  const withSocket: GameState = {
    ...base,
    players: base.players.map(p => ({ ...p, socketId: 'sock-host' })),
    createdAt: NOW - 10 * 60 * 1000,
  }
  return { ...withSocket, ...overrides }
}

const socketAlive = (socketId: string | null) => socketId === 'sock-host'
const socketGone = () => false

describe('shouldExpireIdleRoom', () => {
  it('não expira sala em waiting com jogador conectado, mesmo sem atividade no log', () => {
    const room = buildRoom({ phase: 'waiting', log: [] })
    expect(shouldExpireIdleRoom(room, NOW, IDLE_LIMIT, socketAlive)).toBe(false)
  })

  it('não expira sala em round-end com o último jogador ainda conectado', () => {
    const room = buildRoom({ phase: 'round-end', log: [] })
    expect(shouldExpireIdleRoom(room, NOW, IDLE_LIMIT, socketAlive)).toBe(false)
  })

  it('expira sala abandonada (todos desconectados) acima do limite de inatividade', () => {
    const room = buildRoom({ phase: 'round-end', log: [] })
    expect(shouldExpireIdleRoom(room, NOW, IDLE_LIMIT, socketGone)).toBe(true)
  })

  it('não expira sala abandonada que ainda está dentro do limite', () => {
    const room = buildRoom({ createdAt: NOW - 2 * 60 * 1000, log: [] })
    expect(shouldExpireIdleRoom(room, NOW, IDLE_LIMIT, socketGone)).toBe(false)
  })

  it('usa a última ação do log como atividade para sala abandonada', () => {
    const room = buildRoom({
      log: [{ timestamp: NOW - 60 * 1000, type: 'draw', actorId: 'host' }],
    })
    expect(shouldExpireIdleRoom(room, NOW, IDLE_LIMIT, socketGone)).toBe(false)
  })
})
