import { describe, it, expect } from 'vitest'
import { createEmptyRoom, markDisconnected } from '@/server/game/state'

const baseRoom = () =>
  createEmptyRoom({ roomId: 'r1', name: 'Mesa', hostId: 'p1', hostName: 'Ana', maxPlayers: 4 })

describe('markDisconnected', () => {
  it('marca o jogador como desconectado sem mutar o estado original', () => {
    const state = baseRoom()
    const next = markDisconnected(state, 'p1', 123)

    expect(next.players[0]?.connected).toBe(false)
    expect(next.players[0]?.disconnectedAt).toBe(123)
    expect(state.players[0]?.connected).toBe(true)
    expect(next).not.toBe(state)
  })

  it('retorna o mesmo estado quando o jogador nao existe', () => {
    const state = baseRoom()
    const next = markDisconnected(state, 'fantasma', 123)
    expect(next).toBe(state)
  })
})
