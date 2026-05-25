import { describe, it, expect } from 'vitest'
import { snapCard, closeSnapWindow } from '@/server/game/engine'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function baseState(): GameState {
  const p1: Player = { id: 'p1', socketId: null, name: 'A', hand: [card('7', 'clubs'), card('K')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default' }
  const p2: Player = { id: 'p2', socketId: null, name: 'B', hand: [card('7', 'diamonds'), card('3')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default' }
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [p1, p2],
    deck: [card('Q'), card('A'), card('5'), card('9')],
    discard: [card('7', 'spades')],
    turn: 0, phase: 'playing',
    bateCallerId: null, turnsRemaining: null,
    pendingEffect: null,
    snapWindow: { openedAt: Date.now(), durationMs: 3000, discardedCardId: '7-spades' },
    log: [], createdAt: Date.now(), turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null, roundTurnCount: 0, roundNumber: 1,
  }
}

describe('snapCard - sucesso', () => {
  it('player com 7 corta o 7 do descarte; carta sai da mão', () => {
    const state = baseState()
    const next = snapCard(state, 'p2', 0)
    expect(next.players[1]?.hand).toHaveLength(1)
    expect(next.players[1]?.hand[0]?.rank).toBe('3')
    expect(next.discard[next.discard.length - 1]?.id).toBe('7-diamonds')
  })

  it('log registra snap', () => {
    const state = baseState()
    const next = snapCard(state, 'p2', 0)
    const last = next.log[next.log.length - 1]
    expect(last?.type).toBe('snap')
    expect(last?.actorId).toBe('p2')
  })

  it('snap durante turno alheio é válido', () => {
    const state = baseState()
    const next = snapCard(state, 'p2', 0)
    expect(next.turn).toBe(0)
  })
})

describe('snapCard - falha', () => {
  it('snap sem descarte lança NO_DISCARD', () => {
    const state = { ...baseState(), discard: [] }
    expect(() => snapCard(state, 'p2', 0)).toThrow('NO_DISCARD')
  })

  it('snap fora da fase playing/bate-called lança INVALID_PHASE', () => {
    const state = { ...baseState(), phase: 'effect-pending' as const }
    expect(() => snapCard(state, 'p2', 0)).toThrow('INVALID_PHASE')
  })

  it('snap com carta de rank errado: carta volta e player ganha carta de penalidade', () => {
    const state = { ...baseState(), turn: 1 }
    const next = snapCard(state, 'p1', 1)
    expect(next.players[0]?.hand).toHaveLength(3)
    expect(next.players[0]?.hand.some(c => c.id === 'K-hearts')).toBe(true)
    expect(next.discard[next.discard.length - 1]?.id).toBe('7-spades')
  })

  it('snap errado registra snap-fail no log', () => {
    const state = { ...baseState(), turn: 1 }
    const next = snapCard(state, 'p1', 1)
    const last = next.log[next.log.length - 1]
    expect(last?.type).toBe('snap-fail')
  })

  it('snap errado tira carta do deck pra penalidade', () => {
    const state = { ...baseState(), turn: 1 }
    const deckBefore = state.deck.length
    const next = snapCard(state, 'p1', 1)
    expect(next.deck.length).toBe(deckBefore - 1)
  })

  it('snap na própria vez é permitido pelo engine (cliente controla UX)', () => {
    const state = baseState()
    expect(() => snapCard(state, 'p1', 0)).not.toThrow()
  })
})

describe('closeSnapWindow', () => {
  it('zera snapWindow e mantém fase', () => {
    const state = baseState()
    const next = closeSnapWindow(state)
    expect(next.snapWindow).toBeNull()
    expect(next.phase).toBe('playing')
  })
})
