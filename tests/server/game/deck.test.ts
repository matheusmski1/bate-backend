import { describe, it, expect } from 'vitest'
import { createDeck, shuffleDeck } from '@/server/game/deck'

describe('createDeck', () => {
  it('cria baralho com 54 cartas (52 + 2 jokers)', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(54)
  })

  it('cada carta tem id único', () => {
    const deck = createDeck()
    const ids = new Set(deck.map(c => c.id))
    expect(ids.size).toBe(54)
  })

  it('tem 13 cartas por naipe + 2 jokers', () => {
    const deck = createDeck()
    const hearts = deck.filter(c => c.suit === 'hearts').length
    const diamonds = deck.filter(c => c.suit === 'diamonds').length
    const clubs = deck.filter(c => c.suit === 'clubs').length
    const spades = deck.filter(c => c.suit === 'spades').length
    const jokers = deck.filter(c => c.rank === 'JOKER').length
    expect(hearts).toBe(13)
    expect(diamonds).toBe(13)
    expect(clubs).toBe(13)
    expect(spades).toBe(13)
    expect(jokers).toBe(2)
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
