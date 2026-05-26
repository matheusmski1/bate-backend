import { describe, it, expect } from 'vitest'
import { callBate, finishRound } from '@/server/game/engine'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function threePlayerState(turn = 0): GameState {
  const players: Player[] = [
    { id: 'p1', socketId: null, name: 'A', hand: [card('K'), card('A')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default', deck: 'default', arena: 'default', arena: 'default', arena: 'default', arena: 'default' },
    { id: 'p2', socketId: null, name: 'B', hand: [card('5'), card('10')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default', deck: 'default', arena: 'default', arena: 'default', arena: 'default', arena: 'default' },
    { id: 'p3', socketId: null, name: 'C', hand: [card('7'), card('8')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default', deck: 'default', arena: 'default', arena: 'default', arena: 'default', arena: 'default' },
  ]
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 4,
    players, deck: [], discard: [],
    turn, phase: 'playing',
    bateCallerId: null, turnsRemaining: null,
    pendingEffect: null, snapWindow: null,
    log: [], createdAt: Date.now(), turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null, roundTurnCount: 0, roundNumber: 1, spectators: [],
  }
}

describe('callBate', () => {
  it('marca bateCallerId, seta turnsRemaining = nPlayers - 1, muda phase, avança turno', () => {
    const state = threePlayerState(0)
    const next = callBate(state, 'p1')
    expect(next.bateCallerId).toBe('p1')
    expect(next.turnsRemaining).toBe(2)
    expect(next.phase).toBe('bate-called')
    expect(next.turn).toBe(1)
  })

  it('lança se phase não é playing', () => {
    const state = { ...threePlayerState(), phase: 'effect-pending' as const }
    expect(() => callBate(state, 'p1')).toThrow('INVALID_PHASE')
  })

  it('lança se não é seu turno', () => {
    const state = threePlayerState(1)
    expect(() => callBate(state, 'p1')).toThrow('NOT_YOUR_TURN')
  })

  it('lança se alguém já já chamou BATE', () => {
    const state = { ...threePlayerState(), bateCallerId: 'p2', phase: 'bate-called' as const, turnsRemaining: 1 }
    expect(() => callBate(state, 'p1')).toThrow('BATE_ALREADY_CALLED')
  })

  it('registra bate no log', () => {
    const state = threePlayerState(0)
    const next = callBate(state, 'p1')
    const last = next.log[next.log.length - 1]
    expect(last?.type).toBe('bate')
    expect(last?.actorId).toBe('p1')
  })
})

describe('finishRound', () => {
  it('limpa hands, deck, discard e volta pra waiting se ninguém atingiu 100', () => {
    const state = { ...threePlayerState(), phase: 'round-end' as const }
    const next = finishRound(state)
    expect(next.phase).toBe('waiting')
    expect(next.players.every(p => p.hand.length === 0)).toBe(true)
    expect(next.deck).toEqual([])
    expect(next.discard).toEqual([])
  })

  it('lança se phase não é round-end', () => {
    const state = threePlayerState()
    expect(() => finishRound(state)).toThrow('INVALID_PHASE')
  })

  it('vai pra match-end se algum player já tem >= 100 (scores já somados via advanceTurn)', () => {
    const state: GameState = { ...threePlayerState(), phase: 'round-end' }
    state.players[1]!.score = 100
    const next = finishRound(state)
    expect(next.phase).toBe('match-end')
  })

  it('registra round-end no log', () => {
    const state = { ...threePlayerState(), phase: 'round-end' as const }
    const next = finishRound(state)
    const last = next.log[next.log.length - 1]
    expect(last?.type).toBe('round-end')
  })
})
