import { describe, it, expect } from 'vitest'
import { redactStateForPlayer } from '@/server/game/redact'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function state(): GameState {
  const p1: Player = { id: 'p1', socketId: null, name: 'A', hand: [card('5'), card('K'), card('3'), card('9')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: ['5-hearts', 'K-hearts'] }
  const p2: Player = { id: 'p2', socketId: null, name: 'B', hand: [card('A', 'spades'), card('7'), card('Q'), card('2')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [] }
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [p1, p2],
    deck: [card('J'), card('10'), card('4')],
    discard: [card('6')],
    turn: 0, phase: 'playing',
    caboCallerId: null, turnsRemaining: null,
    pendingEffect: null, snapWindow: null,
    log: [], createdAt: Date.now(), turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
  }
}

describe('redactStateForPlayer', () => {
  it('mostra cartas reveladas da própria mão; esconde resto', () => {
    const redacted = redactStateForPlayer(state(), 'p1')
    const myHand = redacted.players[0]?.hand
    expect(myHand?.[0]).toEqual(card('5'))
    expect(myHand?.[1]).toEqual(card('K'))
    expect(myHand?.[2]).toEqual({ id: '3-hearts', hidden: true })
    expect(myHand?.[3]).toEqual({ id: '9-hearts', hidden: true })
  })

  it('mãos de adversários sempre escondidas', () => {
    const redacted = redactStateForPlayer(state(), 'p1')
    const opp = redacted.players[1]?.hand
    expect(opp?.every(c => 'hidden' in c && c.hidden === true)).toBe(true)
  })

  it('descarte é público', () => {
    const redacted = redactStateForPlayer(state(), 'p1')
    expect(redacted.discard[0]).toEqual(card('6'))
  })

  it('deck nunca aparece, só o count', () => {
    const redacted = redactStateForPlayer(state(), 'p1')
    expect(redacted.deckCount).toBe(3)
    expect('deck' in redacted).toBe(false)
  })

  it('log é público', () => {
    const s = { ...state(), log: [{ timestamp: 1, type: 'draw' as const, actorId: 'p2' }] }
    const redacted = redactStateForPlayer(s, 'p1')
    expect(redacted.log).toHaveLength(1)
  })

  it('mantém metadados do player (id, name, score, connected)', () => {
    const redacted = redactStateForPlayer(state(), 'p2')
    expect(redacted.players[0]?.name).toBe('A')
    expect(redacted.players[0]?.score).toBe(0)
    expect(redacted.players[0]?.connected).toBe(true)
  })
})
