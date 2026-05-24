export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'

export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'JOKER'

export type Card = {
  id: string
  rank: Rank
  suit: Suit | null
}

export type GamePhase =
  | 'waiting'
  | 'initial-peek'
  | 'playing'
  | 'effect-pending'
  | 'cabo-called'
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
}

export type GameActionType =
  | 'draw' | 'discard' | 'snap' | 'snap-fail'
  | 'peek' | 'swap' | 'cabo' | 'round-end' | 'join' | 'leave'

export type GameAction = {
  timestamp: number
  type: GameActionType
  actorId: string
  payload?: Record<string, unknown>
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
  caboCallerId: string | null
  turnsRemaining: number | null
  pendingEffect: PendingEffect | null
  snapWindow: SnapWindow | null
  log: GameAction[]
  createdAt: number
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
}
