import { describe, it, expect } from 'vitest'
import { createDeck, shuffleDeck } from '@/server/game/deck'

describe('createDeck', () => {
  it('cria baralho duplo com 108 cartas (2 × 52 + 2 × 2 jokers)', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(108)
  })

  it('cada carta tem id único', () => {
    const deck = createDeck()
    const ids = new Set(deck.map(c => c.id))
    expect(ids.size).toBe(108)
  })

  it('tem 26 cartas por naipe + 4 jokers (deck duplicado)', () => {
    const deck = createDeck()
    const hearts = deck.filter(c => c.suit === 'hearts').length
    const diamonds = deck.filter(c => c.suit === 'diamonds').length
    const clubs = deck.filter(c => c.suit === 'clubs').length
    const spades = deck.filter(c => c.suit === 'spades').length
    const jokers = deck.filter(c => c.rank === 'JOKER').length
    expect(hearts).toBe(26)
    expect(diamonds).toBe(26)
    expect(clubs).toBe(26)
    expect(spades).toBe(26)
    expect(jokers).toBe(4)
  })

  it('jokers têm suit null', () => {
    const deck = createDeck()
    const jokers = deck.filter(c => c.rank === 'JOKER')
    expect(jokers.every(c => c.suit === null)).toBe(true)
  })
})

describe('shuffleDeck', () => {
  it('retorna baralho com mesmo tamanho', () => {
    const deck = createDeck()
    const shuffled = shuffleDeck(deck)
    expect(shuffled).toHaveLength(deck.length)
  })

  it('contém exatamente as mesmas cartas', () => {
    const deck = createDeck()
    const shuffled = shuffleDeck(deck)
    const originalIds = new Set(deck.map(c => c.id))
    const shuffledIds = new Set(shuffled.map(c => c.id))
    expect(shuffledIds).toEqual(originalIds)
  })

  it('embaralha a ordem (estatisticamente quase certo de não ser igual)', () => {
    const deck = createDeck()
    const shuffled = shuffleDeck(deck)
    const sameOrder = deck.every((c, i) => c.id === shuffled[i]?.id)
    expect(sameOrder).toBe(false)
  })
})
