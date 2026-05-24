import { randomUUID } from 'node:crypto'
import type { Card, Rank, Suit } from '@/types/shared'

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']

export function createDeck(): Card[] {
  const cards: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: randomUUID(), rank, suit })
    }
  }
  cards.push({ id: randomUUID(), rank: 'JOKER', suit: null })
  cards.push({ id: randomUUID(), rank: 'JOKER', suit: null })
  return cards
}

export function shuffleDeck(deck: Card[]): Card[] {
  const result = [...deck]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = result[i]!
    result[i] = result[j]!
    result[j] = tmp
  }
  return result
}
