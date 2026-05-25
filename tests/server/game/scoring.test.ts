import { describe, it, expect } from 'vitest'
import { scoreHand, isMatchEnd, getMatchLoser } from '@/server/game/scoring'
import type { Card, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts'): Card {
  return { id: `${rank}-${suit}`, rank, suit }
}

function player(id: string, score: number): Player {
  return { id, socketId: null, name: id, hand: [], score, connected: true, disconnectedAt: null, revealedToSelf: [], skin: 'default' }
}

describe('scoreHand', () => {
  it('A vale 1', () => {
    expect(scoreHand([card('A')])).toBe(1)
  })

  it('número vale valor nominal', () => {
    expect(scoreHand([card('7')])).toBe(7)
  })

  it('10/J/Q valem o número impresso', () => {
    expect(scoreHand([card('10')])).toBe(10)
    expect(scoreHand([card('J')])).toBe(11)
    expect(scoreHand([card('Q')])).toBe(12)
  })

  it('K vale -3', () => {
    expect(scoreHand([card('K')])).toBe(-3)
  })

  it('Joker vale -6', () => {
    expect(scoreHand([{ id: 'jk', rank: 'JOKER', suit: null }])).toBe(-6)
  })

  it('soma várias cartas', () => {
    const hand = [card('5'), card('K'), { id: 'jk', rank: 'JOKER' as const, suit: null }, card('A')]
    expect(scoreHand(hand)).toBe(5 - 3 - 6 + 1)
  })

  it('mão vazia vale 0', () => {
    expect(scoreHand([])).toBe(0)
  })
})

describe('isMatchEnd', () => {
  it('retorna true se algum player atinge 100', () => {
    expect(isMatchEnd([player('a', 100), player('b', 50)])).toBe(true)
  })

  it('retorna true se algum player ultrapassa 100', () => {
    expect(isMatchEnd([player('a', 110), player('b', 50)])).toBe(true)
  })

  it('retorna false se ninguém chegou a 100', () => {
    expect(isMatchEnd([player('a', 99), player('b', 50)])).toBe(false)
  })
})

describe('getMatchLoser', () => {
  it('retorna o player com maior score (perde quem fez mais pontos)', () => {
    const players = [player('a', 50), player('b', 105), player('c', 80)]
    expect(getMatchLoser(players)?.id).toBe('b')
  })

  it('retorna null se ninguém atingiu 100', () => {
    const players = [player('a', 50), player('b', 80)]
    expect(getMatchLoser(players)).toBeNull()
  })
})
