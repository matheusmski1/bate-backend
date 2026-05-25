import type { GameState, Player } from '@/types/shared'
import { createDeck, shuffleDeck } from './deck'

type CreateRoomInput = {
  roomId: string
  name: string
  hostId: string
  hostName: string
  maxPlayers: 2 | 3 | 4
  turnTimeLimitSec?: number | null
}

export function createEmptyRoom(input: CreateRoomInput): GameState {
  const host: Player = {
    id: input.hostId,
    socketId: null,
    name: input.hostName,
    hand: [],
    score: 0,
    connected: true,
    disconnectedAt: null,
    revealedToSelf: [],
  }
  return {
    roomId: input.roomId,
    name: input.name,
    hostId: input.hostId,
    maxPlayers: input.maxPlayers,
    players: [host],
    deck: [],
    discard: [],
    turn: 0,
    phase: 'waiting',
    caboCallerId: null,
    turnsRemaining: null,
    pendingEffect: null,
    snapWindow: null,
    log: [],
    createdAt: Date.now(),
    turnTimeLimitSec: input.turnTimeLimitSec ?? 60,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    roundTurnCount: 0,
  }
}

export function startRound(state: GameState): GameState {
  const deck = shuffleDeck(createDeck())
  const players = state.players.map(p => {
    const hand = deck.splice(0, 4)
    const initiallyRevealed = hand.slice(-2).map(c => c.id)
    return { ...p, hand, score: p.score, revealedToSelf: initiallyRevealed }
  })
  const lowestIdx = players.reduce((bestIdx, p, i) => (p.score < players[bestIdx]!.score ? i : bestIdx), 0)
  return {
    ...state,
    players,
    deck,
    discard: [],
    turn: lowestIdx,
    phase: 'initial-peek',
    caboCallerId: null,
    turnsRemaining: null,
    pendingEffect: null,
    snapWindow: null,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    roundTurnCount: 1,
  }
}
