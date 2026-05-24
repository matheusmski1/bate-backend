import type { Card, Player } from '@/types/shared'

const CARD_VALUES: Record<Card['rank'], number> = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': -3, 'JOKER': -6,
}

export function scoreHand(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + CARD_VALUES[c.rank], 0)
}

export function isMatchEnd(players: Player[]): boolean {
  return players.some(p => p.score >= 100)
}

export function getMatchLoser(players: Player[]): Player | null {
  if (!isMatchEnd(players)) return null
  return players.reduce((max, p) => (p.score > max.score ? p : max), players[0]!)
}
