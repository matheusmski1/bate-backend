import type { GameState, Player } from '@/types/shared'
import { createDeck, shuffleDeck } from './deck'

type CreateRoomInput = {
  roomId: string
  name: string
  hostId: string
  hostName: string
  maxPlayers: 2 | 3 | 4
  turnTimeLimitSec?: number | null
  deck?: string
  arena?: string
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
    deck: input.deck ?? 'default',
    arena: input.arena ?? 'default',
  }
  return {
    roomId: input.roomId,
    name: input.name,
    hostId: input.hostId,
    maxPlayers: input.maxPlayers,
    players: [host],
    pendingJoins: [],
    deck: [],
    discard: [],
    turn: 0,
    phase: 'waiting',
    bateCallerId: null,
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
    roundNumber: 0,
    spectators: [],
  }
}

export function startRound(state: GameState): GameState {
  const deck = shuffleDeck(createDeck())
  const slotsAvailable = state.maxPlayers - state.players.length
  const toPromote = state.pendingJoins.slice(0, Math.max(0, slotsAvailable))
  const remainingPending = state.pendingJoins.slice(toPromote.length)
  const promoted: Player[] = toPromote.map(p => ({
    ...p,
    hand: [],
    score: 0,
    revealedToSelf: [],
  }))
  const allPlayers = [...state.players, ...promoted]
  const players = allPlayers.map(p => {
    const hand = deck.splice(0, 4)
    const initiallyRevealed = hand.slice(-2).map(c => c.id)
    return { ...p, hand, score: p.score, revealedToSelf: initiallyRevealed }
  })
  const lowestIdx = players.reduce((bestIdx, p, i) => (p.score < players[bestIdx]!.score ? i : bestIdx), 0)
  const promotedIds = new Set(toPromote.map(p => p.id))
  const spectators = (state.spectators ?? []).filter(s => !promotedIds.has(s.id))
  return {
    ...state,
    players,
    pendingJoins: remainingPending,
    spectators,
    deck,
    discard: [],
    turn: lowestIdx,
    phase: 'initial-peek',
    bateCallerId: null,
    turnsRemaining: null,
    pendingEffect: null,
    snapWindow: null,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    roundTurnCount: 1,
    roundNumber: state.roundNumber + 1,
  }
}
