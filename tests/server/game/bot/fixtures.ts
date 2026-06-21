import { createEmptyRoom, startRound } from '@/server/game/state'
import type { GameState, BotLevel, Card, Rank, Suit } from '@/types/shared'

export function card(id: string, rank: Rank, suit: Suit | null = 'hearts'): Card {
  return { id, rank, suit }
}

export function practiceRound(botLevels: BotLevel[]): GameState {
  const empty = createEmptyRoom({ roomId: 'R1', name: 'm', hostId: 'human', hostName: 'Eu', maxPlayers: (botLevels.length + 1) as 2 | 3 | 4 })
  botLevels.forEach((level, i) => {
    empty.players.push({
      id: `bot:R1:${i}`, socketId: null, name: `Bot${i}`, hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
      isBot: true, botLevel: level,
    })
  })
  return { ...startRound(empty), phase: 'playing' }
}

export function setHand(state: GameState, playerId: string, hand: Card[], revealed: string[] = []): GameState {
  return {
    ...state,
    players: state.players.map(p => (p.id === playerId ? { ...p, hand, revealedToSelf: revealed } : p)),
  }
}
