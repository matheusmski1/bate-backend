import { describe, it, expect } from 'vitest'
import { tallyRound, openFinalSnapWindow, extendFinalSnapWindow, discardDrawnCard, callBate } from '@/server/game/engine'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function bateState(overrides: Partial<GameState> = {}): GameState {
  const players: Player[] = [
    { id: 'p1', socketId: null, name: 'A', hand: [], score: 10, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    { id: 'p2', socketId: null, name: 'B', hand: [card('K'), card('5')], score: 20, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
  ]
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2, players, pendingJoins: [],
    deck: [], discard: [card('A', 'spades')], turn: 0, phase: 'bate-called',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null, snapWindow: null,
    log: [{ timestamp: 1, type: 'discard', actorId: 'p2' }],
    createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: 999, paused: false, pausedRemainingMs: null,
    roundTurnCount: 3, roundNumber: 1, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

describe('openFinalSnapWindow', () => {
  it('abre fase final-snap sem calcular score, com snapWindow no topo do descarte', () => {
    const next = openFinalSnapWindow(bateState(), 2500)
    expect(next.phase).toBe('final-snap')
    expect(next.players[1]!.score).toBe(20)
    expect(next.turnDeadlineAt).toBeNull()
    expect(next.snapWindow?.discardedCardId).toBe('A-spades')
    expect(next.snapWindow?.durationMs).toBe(2500)
  })
})

describe('tallyRound', () => {
  it('soma scoreHand das mãos atuais e vira round-end', () => {
    const next = tallyRound(openFinalSnapWindow(bateState(), 2500))
    expect(next.phase).toBe('round-end')
    expect(next.players[1]!.score).toBe(20 + (-3) + 5)
    expect(next.snapWindow).toBeNull()
    expect(next.log[next.log.length - 1]!.type).toBe('round-end')
  })

  it('vira match-end se algum score >= 100', () => {
    const s = openFinalSnapWindow(bateState({ players: [
      { id: 'p1', socketId: null, name: 'A', hand: [card('Q')], score: 99, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [card('K')], score: 20, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ] }), 2500)
    expect(tallyRound(s).phase).toBe('match-end')
  })
})

describe('extendFinalSnapWindow', () => {
  it('reinicia o snapWindow com a nova duração', () => {
    const opened = openFinalSnapWindow(bateState(), 2500)
    const extended = extendFinalSnapWindow(opened, 2000)
    expect(extended.snapWindow?.durationMs).toBe(2000)
    expect(extended.phase).toBe('final-snap')
  })
})

describe('última ação do bate abre final-snap em vez de finalizar', () => {
  it('2 jogadores: descarte final do bate vira final-snap, não round-end', () => {
    const players: Player[] = [
      { id: 'p1', socketId: null, name: 'A', hand: [card('3')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [card('K'), card('K', 'clubs', 'K-clubs')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ]
    const base: GameState = {
      roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2, players, pendingJoins: [],
      deck: [card('9')], discard: [card('2')], turn: 0, phase: 'playing',
      bateCallerId: null, turnsRemaining: null, pendingEffect: null, snapWindow: null,
      log: [], createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
      roundTurnCount: 0, roundNumber: 1, roundStartedAt: 1, spectators: [],
    }
    const afterBate = callBate(base, 'p1')
    expect(afterBate.phase).toBe('bate-called')
    expect(afterBate.turnsRemaining).toBe(1)
    expect(afterBate.turn).toBe(1)
    const afterLast = discardDrawnCard(afterBate, 'p2', card('7'), false)
    expect(afterLast.phase).toBe('final-snap')
    expect(afterLast.players[1]!.score).toBe(0)
  })
})
