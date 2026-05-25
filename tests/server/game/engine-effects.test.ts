import { describe, it, expect } from 'vitest'
import { resolveEffect } from '@/server/game/engine'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function stateWithEffect(type: 'peek-own' | 'peek-other' | 'swap'): GameState {
  const p1: Player = { id: 'p1', socketId: null, name: 'A', hand: [card('5'), card('K'), card('3'), card('9')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default' }
  const p2: Player = { id: 'p2', socketId: null, name: 'B', hand: [card('A'), card('7'), card('Q'), card('2')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default' }
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [p1, p2],
    deck: [], discard: [],
    turn: 0, phase: 'effect-pending',
    bateCallerId: null, turnsRemaining: null,
    pendingEffect: { type, playerId: 'p1' },
    snapWindow: null,
    log: [], createdAt: Date.now(), turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null, roundTurnCount: 0, roundNumber: 1, spectators: [],
  }
}

describe('resolveEffect - peek-own', () => {
  it('retorna a carta no índice solicitado e avança turno', () => {
    const state = stateWithEffect('peek-own')
    const { state: next, revealed } = resolveEffect(state, 'p1', { targetPlayerId: 'p1', targetCardIndex: 1 })
    expect(revealed).toEqual([{ ownerId: 'p1', cardIndex: 1, card: card('K') }])
    expect(next.phase).toBe('playing')
    expect(next.pendingEffect).toBeNull()
    expect(next.turn).toBe(1)
  })

  it('lança se tentar espiar carta de outro player', () => {
    const state = stateWithEffect('peek-own')
    expect(() => resolveEffect(state, 'p1', { targetPlayerId: 'p2', targetCardIndex: 1 })).toThrow('INVALID_TARGET')
  })
})

describe('resolveEffect - peek-other', () => {
  it('retorna carta do adversário e avança turno', () => {
    const state = stateWithEffect('peek-other')
    const { state: next, revealed } = resolveEffect(state, 'p1', { targetPlayerId: 'p2', targetCardIndex: 2 })
    expect(revealed).toEqual([{ ownerId: 'p2', cardIndex: 2, card: card('Q') }])
    expect(next.turn).toBe(1)
  })

  it('lança se tentar espiar própria carta', () => {
    const state = stateWithEffect('peek-other')
    expect(() => resolveEffect(state, 'p1', { targetPlayerId: 'p1', targetCardIndex: 0 })).toThrow('INVALID_TARGET')
  })
})

describe('resolveEffect - swap', () => {
  it('troca carta da própria mão com carta de outro player', () => {
    const state = stateWithEffect('swap')
    const { state: next } = resolveEffect(state, 'p1', { targetPlayerId: 'p2', targetCardIndex: 0, myCardIndex: 3 })
    expect(next.players[0]?.hand[3]?.rank).toBe('A')
    expect(next.players[1]?.hand[0]?.rank).toBe('9')
    expect(next.turn).toBe(1)
  })

  it('lança sem myCardIndex', () => {
    const state = stateWithEffect('swap')
    expect(() => resolveEffect(state, 'p1', { targetPlayerId: 'p2', targetCardIndex: 0 })).toThrow('MY_CARD_INDEX_REQUIRED')
  })

  it('lança ao tentar swap com a si mesmo', () => {
    const state = stateWithEffect('swap')
    expect(() => resolveEffect(state, 'p1', { targetPlayerId: 'p1', targetCardIndex: 0, myCardIndex: 1 })).toThrow('INVALID_TARGET')
  })
})

describe('resolveEffect - acesso', () => {
  it('lança se não há pending effect', () => {
    const state = { ...stateWithEffect('peek-own'), pendingEffect: null, phase: 'playing' as const }
    expect(() => resolveEffect(state, 'p1', { targetPlayerId: 'p1', targetCardIndex: 0 })).toThrow('NO_PENDING_EFFECT')
  })

  it('lança se player não é o dono do effect', () => {
    const state = stateWithEffect('peek-own')
    expect(() => resolveEffect(state, 'p2', { targetPlayerId: 'p2', targetCardIndex: 0 })).toThrow('NOT_YOUR_EFFECT')
  })
})
