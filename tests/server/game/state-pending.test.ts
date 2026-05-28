import { describe, it, expect } from 'vitest'
import { createEmptyRoom, startRound } from '@/server/game/state'
import type { Player } from '@/types/shared'

function mkPlayer(id: string, name: string): Player {
  return {
    id, socketId: null, name, hand: [], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
  }
}

describe('startRound — promoção de pendingJoins', () => {
  it('promove pendingJoins para players e esvazia a fila', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 4 })
    empty.players.push(mkPlayer('p2', 'b'))
    empty.pendingJoins.push(mkPlayer('p3', 'c'))
    const state = startRound(empty)
    expect(state.players.map(p => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(state.pendingJoins).toEqual([])
  })

  it('jogador promovido recebe 4 cartas', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 4 })
    empty.players.push(mkPlayer('p2', 'b'))
    empty.pendingJoins.push(mkPlayer('p3', 'c'))
    const state = startRound(empty)
    const p3 = state.players.find(p => p.id === 'p3')
    expect(p3?.hand).toHaveLength(4)
  })

  it('não promove além de maxPlayers e mantém o resto na fila', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
    empty.pendingJoins.push(mkPlayer('p2', 'b'))
    empty.pendingJoins.push(mkPlayer('p3', 'c'))
    const state = startRound(empty)
    expect(state.players.map(p => p.id)).toEqual(['p1', 'p2'])
    expect(state.pendingJoins.map(p => p.id)).toEqual(['p3'])
  })

  it('zera score do promovido (não herda score residual)', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 4 })
    empty.players.push(mkPlayer('p2', 'b'))
    const stale = mkPlayer('p3', 'c')
    stale.score = 99
    empty.pendingJoins.push(stale)
    const state = startRound(empty)
    const p3 = state.players.find(p => p.id === 'p3')
    expect(p3?.score).toBe(0)
  })
})
