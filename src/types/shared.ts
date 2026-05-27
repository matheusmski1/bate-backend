export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'

export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'JOKER'

export type Card = {
  id: string
  rank: Rank
  suit: Suit | null
  discardedBy?: string
}

export type GamePhase =
  | 'waiting'
  | 'initial-peek'
  | 'playing'
  | 'effect-pending'
  | 'bate-called'
  | 'round-end'
  | 'match-end'

export type EffectType = 'peek-own' | 'peek-other' | 'swap'

export type PendingEffect = {
  type: EffectType
  playerId: string
}

export type SnapWindow = {
  openedAt: number
  durationMs: number
  discardedCardId: string
}

export type Player = {
  id: string
  socketId: string | null
  name: string
  hand: Card[]
  score: number
  connected: boolean
  disconnectedAt: number | null
  revealedToSelf: string[]
  deck: string
  arena: string
}

export type GameActionType =
  | 'draw' | 'discard' | 'snap' | 'snap-fail'
  | 'peek' | 'swap' | 'bate' | 'round-end' | 'join' | 'leave'

export type GameAction = {
  timestamp: number
  type: GameActionType
  actorId: string
  payload?: Record<string, unknown>
}

export type Spectator = {
  id: string
  name: string
  socketId: string | null
}

export type GameState = {
  roomId: string
  name: string
  hostId: string
  maxPlayers: 2 | 3 | 4
  players: Player[]
  deck: Card[]
  discard: Card[]
  turn: number
  phase: GamePhase
  bateCallerId: string | null
  turnsRemaining: number | null
  pendingEffect: PendingEffect | null
  snapWindow: SnapWindow | null
  log: GameAction[]
  createdAt: number
  turnTimeLimitSec: number | null
  turnDeadlineAt: number | null
  paused: boolean
  pausedRemainingMs: number | null
  roundTurnCount: number
  roundNumber: number
  spectators: Spectator[]
}

export type RedactedCard = { id: string; rank: Rank; suit: Suit | null } | { id: string; hidden: true }

export type RedactedPlayer = Omit<Player, 'hand'> & { hand: RedactedCard[] }

export type RedactedState = Omit<GameState, 'players' | 'deck'> & {
  players: RedactedPlayer[]
  deckCount: number
}

export type RoomSummary = {
  roomId: string
  name: string
  playerCount: number
  maxPlayers: number
  phase: GamePhase
  spectatorCount: number
}
