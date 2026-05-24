import { describe, it, expect } from 'vitest'
import { createEmptyRoom, startRound } from '@/server/game/state'

describe('createEmptyRoom', () => {
  it('cria sala em fase waiting com host como primeiro player', () => {
    const state = createEmptyRoom({
      roomId: 'r1',
      name: 'Mesa do Matheus',
      hostId: 'p1',
      hostName: 'Matheus',
      maxPlayers: 4,
    })
    expect(state.phase).toBe('waiting')
    expect(state.players).toHaveLength(1)
    expect(state.players[0]?.id).toBe('p1')
    expect(state.players[0]?.name).toBe('Matheus')
    expect(state.players[0]?.hand).toEqual([])
    expect(state.players[0]?.score).toBe(0)
    expect(state.deck).toEqual([])
    expect(state.discard).toEqual([])
    expect(state.maxPlayers).toBe(4)
  })
})

describe('startRound', () => {
  it('distribui 4 cartas pra cada player', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
    empty.players.push({
      id: 'p2', socketId: null, name: 'b', hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [],
    })
    const state = startRound(empty)
    expect(state.players[0]?.hand).toHaveLength(4)
    expect(state.players[1]?.hand).toHaveLength(4)
  })

  it('inicia em initial-peek phase', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
    empty.players.push({
      id: 'p2', socketId: null, name: 'b', hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [],
    })
    const state = startRound(empty)
    expect(state.phase).toBe('initial-peek')
  })

  it('remaining deck tem 54 - (4 * nPlayers) cartas', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
    empty.players.push({
      id: 'p2', socketId: null, name: 'b', hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [],
    })
    const state = startRound(empty)
    expect(state.deck.length).toBe(54 - 8)
  })

  it('reseta turn pra 0 e limpa pendingEffect/snapWindow', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
    empty.players.push({
      id: 'p2', socketId: null, name: 'b', hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [],
    })
    const state = startRound(empty)
    expect(state.turn).toBe(0)
    expect(state.pendingEffect).toBeNull()
    expect(state.snapWindow).toBeNull()
    expect(state.caboCallerId).toBeNull()
  })
})
