import type { GameState, GameAction, Player, GamePhase } from '@/types/shared'
import { createDeck, shuffleDeck } from './deck'

export function trimLog(log: GameAction[], max: number): GameAction[] {
  return log.length > max ? log.slice(-max) : log
}

export function isEndPhase(phase: GamePhase): boolean {
  return phase === 'round-end' || phase === 'match-end'
}

export function isBoardPhase(phase: GamePhase): boolean {
  return phase === 'playing' || phase === 'bate-called' || phase === 'effect-pending' || phase === 'final-snap'
}

type CreateRoomInput = {
  roomId: string
  name: string
  hostId: string
  hostName: string
  maxPlayers: 2 | 3 | 4
  turnTimeLimitSec?: number | null
  deck?: string
  arena?: string
  private?: boolean
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
    roundStartedAt: null,
    spectators: [],
    private: input.private ?? false,
  }
}

export function markDisconnected(state: GameState, playerId: string, now: number): GameState {
  const idx = state.players.findIndex(p => p.id === playerId)
  if (idx === -1) return state
  const players = state.players.map((p, i) =>
    i === idx ? { ...p, connected: false, disconnectedAt: now } : p,
  )
  return { ...state, players }
}

export function rebindSocket(state: GameState, playerId: string, socketId: string): GameState {
  const idx = state.players.findIndex(p => p.id === playerId)
  if (idx === -1) return state
  const players = state.players.map((p, i) =>
    i === idx ? { ...p, socketId, connected: true, disconnectedAt: null } : p,
  )
  return { ...state, players }
}

export function lastActivityAt(state: GameState): number {
  return Math.max(state.createdAt, ...state.log.map(l => l.timestamp))
}

export function shouldExpireIdleRoom(
  state: GameState,
  now: number,
  idleLimitMs: number,
  isConnected: (socketId: string | null) => boolean,
): boolean {
  const anyConnected = state.players.some(p => isConnected(p.socketId))
  if (anyConnected) return false
  return now - lastActivityAt(state) > idleLimitMs
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
    roundStartedAt: Date.now(),
  }
}
