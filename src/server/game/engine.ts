import type { Card, GameState, GameAction, GameActionType } from '@/types/shared'
import { scoreHand, isMatchEnd } from './scoring'

const SNAP_WINDOW_MS = 3000
const MAX_HAND_SIZE = 10

function logEvent(state: GameState, type: GameActionType, actorId: string, payload?: Record<string, unknown>): GameAction[] {
  return [...state.log, { timestamp: Date.now(), type, actorId, payload }]
}

function currentPlayerId(state: GameState): string {
  return state.players[state.turn]!.id
}

function advanceTurn(state: GameState): GameState {
  const nextTurn = (state.turn + 1) % state.players.length
  let phase = state.phase
  let turnsRemaining = state.turnsRemaining
  let players = state.players
  if (state.phase === 'cabo-called' && state.turnsRemaining !== null) {
    turnsRemaining = state.turnsRemaining - 1
    if (turnsRemaining <= 0) {
      players = state.players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
      phase = isMatchEnd(players) ? 'match-end' : 'round-end'
    }
  }
  return { ...state, players, turn: nextTurn, phase, turnsRemaining }
}

export function drawFromDeck(state: GameState, playerId: string): { state: GameState; card: Card | null } {
  if (state.phase !== 'playing' && state.phase !== 'cabo-called') {
    throw new Error('INVALID_PHASE')
  }
  if (currentPlayerId(state) !== playerId) {
    throw new Error('NOT_YOUR_TURN')
  }
  if (state.deck.length === 0) {
    return { state: endRoundEmptyDeck(state), card: null }
  }
  const deck = [...state.deck]
  const card = deck.pop()!
  return {
    state: { ...state, deck, log: logEvent(state, 'draw', playerId) },
    card,
  }
}

export function endRoundEmptyDeck(state: GameState): GameState {
  const players = state.players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
  const phase: GameState['phase'] = isMatchEnd(players) ? 'match-end' : 'round-end'
  return {
    ...state,
    players,
    phase,
    pendingEffect: null,
    snapWindow: null,
    log: [...state.log, { timestamp: Date.now(), type: 'round-end', actorId: '', payload: { reason: 'deck-empty' } }],
  }
}

function effectFromRank(card: Card, playerId: string): GameState['pendingEffect'] {
  if (card.rank === '10') return { type: 'peek-own', playerId }
  if (card.rank === 'J') return { type: 'peek-other', playerId }
  if (card.rank === 'Q') return { type: 'swap', playerId }
  return null
}

export function discardDrawnCard(state: GameState, playerId: string, card: Card): GameState {
  if (currentPlayerId(state) !== playerId) {
    throw new Error('NOT_YOUR_TURN')
  }
  const discard = [...state.discard, card]
  const pendingEffect = effectFromRank(card, playerId)
  const log = logEvent(state, 'discard', playerId, { cardId: card.id, rank: card.rank })
  const afterDiscard: GameState = { ...state, discard, log, snapWindow: null }
  if (pendingEffect) {
    return { ...afterDiscard, phase: 'effect-pending', pendingEffect }
  }
  return advanceTurn(afterDiscard)
}

export function swapAndDiscard(state: GameState, playerId: string, drawn: Card, handIndex: number): GameState {
  if (currentPlayerId(state) !== playerId) {
    throw new Error('NOT_YOUR_TURN')
  }
  const playerIdx = state.players.findIndex(p => p.id === playerId)
  const player = state.players[playerIdx]!
  if (handIndex < 0 || handIndex >= player.hand.length) {
    throw new Error('INVALID_HAND_INDEX')
  }
  const oldCard = player.hand[handIndex]!
  const newHand = [...player.hand]
  newHand[handIndex] = drawn
  const players = [...state.players]
  players[playerIdx] = { ...player, hand: newHand }
  const discard = [...state.discard, oldCard]
  const pendingEffect = effectFromRank(oldCard, playerId)
  const log = logEvent(state, 'discard', playerId, { cardId: oldCard.id, rank: oldCard.rank, swappedFromHand: true })
  const afterSwap: GameState = { ...state, players, discard, log, snapWindow: null }
  if (pendingEffect) {
    return { ...afterSwap, phase: 'effect-pending', pendingEffect }
  }
  return advanceTurn(afterSwap)
}

export function snapCard(state: GameState, playerId: string, handIndex: number): GameState {
  if (state.discard.length === 0) {
    throw new Error('NO_DISCARD')
  }
  if (state.phase !== 'playing' && state.phase !== 'cabo-called') {
    throw new Error('INVALID_PHASE')
  }
  const playerIdx = state.players.findIndex(p => p.id === playerId)
  if (playerIdx === -1) throw new Error('PLAYER_NOT_FOUND')
  const player = state.players[playerIdx]!
  if (handIndex < 0 || handIndex >= player.hand.length) {
    throw new Error('INVALID_HAND_INDEX')
  }
  const snappedCard = player.hand[handIndex]!
  const topDiscard = state.discard[state.discard.length - 1]
  if (!topDiscard) throw new Error('NO_DISCARD')

  if (snappedCard.rank === topDiscard.rank) {
    const newHand = player.hand.filter((_, i) => i !== handIndex)
    const players = [...state.players]
    players[playerIdx] = { ...player, hand: newHand }
    return {
      ...state,
      players,
      discard: [...state.discard, snappedCard],
      log: [...state.log, { timestamp: Date.now(), type: 'snap', actorId: playerId, payload: { cardId: snappedCard.id, rank: snappedCard.rank } }],
    }
  }

  if (player.hand.length >= MAX_HAND_SIZE) {
    return {
      ...state,
      log: [...state.log, { timestamp: Date.now(), type: 'snap-fail', actorId: playerId, payload: { attemptedRank: snappedCard.rank, capped: true } }],
    }
  }
  if (state.deck.length === 0) {
    return endRoundEmptyDeck(state)
  }
  const deck = [...state.deck]
  const penalty = deck.pop()!
  const players = [...state.players]
  players[playerIdx] = { ...player, hand: [...player.hand, penalty] }
  return {
    ...state,
    players,
    deck,
    log: [...state.log, { timestamp: Date.now(), type: 'snap-fail', actorId: playerId, payload: { attemptedRank: snappedCard.rank } }],
  }
}

export function closeSnapWindow(state: GameState): GameState {
  return { ...state, snapWindow: null }
}

type EffectInput = { targetPlayerId: string; targetCardIndex: number; myCardIndex?: number }
type EffectRevealed = Array<{ ownerId: string; cardIndex: number; card: Card }>

export function resolveEffect(state: GameState, playerId: string, input: EffectInput): { state: GameState; revealed: EffectRevealed } {
  if (!state.pendingEffect) throw new Error('NO_PENDING_EFFECT')
  if (state.pendingEffect.playerId !== playerId) throw new Error('NOT_YOUR_EFFECT')
  const targetIdx = state.players.findIndex(p => p.id === input.targetPlayerId)
  if (targetIdx === -1) throw new Error('TARGET_NOT_FOUND')
  const target = state.players[targetIdx]!
  if (input.targetCardIndex < 0 || input.targetCardIndex >= target.hand.length) {
    throw new Error('INVALID_HAND_INDEX')
  }
  const targetCard = target.hand[input.targetCardIndex]!
  const restoredPhase: GameState['phase'] = state.caboCallerId !== null ? 'cabo-called' : 'playing'

  if (state.pendingEffect.type === 'peek-own') {
    if (input.targetPlayerId !== playerId) throw new Error('INVALID_TARGET')
    const cleared: GameState = { ...state, pendingEffect: null, phase: restoredPhase }
    const next = advanceTurnExported(cleared)
    return {
      state: { ...next, log: [...next.log, { timestamp: Date.now(), type: 'peek', actorId: playerId, payload: { targetPlayerId: playerId, cardIndex: input.targetCardIndex } }] },
      revealed: [{ ownerId: playerId, cardIndex: input.targetCardIndex, card: targetCard }],
    }
  }

  if (state.pendingEffect.type === 'peek-other') {
    if (input.targetPlayerId === playerId) throw new Error('INVALID_TARGET')
    const cleared: GameState = { ...state, pendingEffect: null, phase: restoredPhase }
    const next = advanceTurnExported(cleared)
    return {
      state: { ...next, log: [...next.log, { timestamp: Date.now(), type: 'peek', actorId: playerId, payload: { targetPlayerId: input.targetPlayerId, cardIndex: input.targetCardIndex } }] },
      revealed: [{ ownerId: input.targetPlayerId, cardIndex: input.targetCardIndex, card: targetCard }],
    }
  }

  if (input.myCardIndex === undefined) throw new Error('MY_CARD_INDEX_REQUIRED')
  if (input.targetPlayerId === playerId) throw new Error('INVALID_TARGET')
  const myIdx = state.players.findIndex(p => p.id === playerId)
  const me = state.players[myIdx]!
  if (input.myCardIndex < 0 || input.myCardIndex >= me.hand.length) throw new Error('INVALID_HAND_INDEX')
  const myCard = me.hand[input.myCardIndex]!

  const newMyHand = [...me.hand]
  newMyHand[input.myCardIndex] = targetCard
  const newTargetHand = [...target.hand]
  newTargetHand[input.targetCardIndex] = myCard

  const players = [...state.players]
  players[myIdx] = { ...me, hand: newMyHand }
  players[targetIdx] = { ...target, hand: newTargetHand }

  const cleared: GameState = { ...state, players, pendingEffect: null, phase: restoredPhase }
  const next = advanceTurnExported(cleared)
  return {
    state: { ...next, log: [...next.log, { timestamp: Date.now(), type: 'swap', actorId: playerId, payload: { targetPlayerId: input.targetPlayerId, myCardIndex: input.myCardIndex, targetCardIndex: input.targetCardIndex } }] },
    revealed: [],
  }
}

export function skipEffect(state: GameState, playerId: string): GameState {
  if (!state.pendingEffect) throw new Error('NO_PENDING_EFFECT')
  if (state.pendingEffect.playerId !== playerId) throw new Error('NOT_YOUR_EFFECT')
  const restoredPhase: GameState['phase'] = state.caboCallerId !== null ? 'cabo-called' : 'playing'
  const cleared: GameState = {
    ...state,
    pendingEffect: null,
    phase: restoredPhase,
    log: [...state.log, { timestamp: Date.now(), type: 'peek', actorId: playerId, payload: { skipped: true } }],
  }
  return advanceTurnExported(cleared)
}

function advanceTurnExported(state: GameState): GameState {
  const nextTurn = (state.turn + 1) % state.players.length
  let phase = state.phase
  let turnsRemaining = state.turnsRemaining
  let players = state.players
  if (state.phase === 'cabo-called' && state.turnsRemaining !== null) {
    turnsRemaining = state.turnsRemaining - 1
    if (turnsRemaining <= 0) {
      players = state.players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
      phase = isMatchEnd(players) ? 'match-end' : 'round-end'
    }
  }
  return { ...state, players, turn: nextTurn, phase, turnsRemaining }
}

export function callCabo(state: GameState, playerId: string): GameState {
  if (state.caboCallerId !== null) throw new Error('CABO_ALREADY_CALLED')
  if (state.phase !== 'playing') throw new Error('INVALID_PHASE')
  if (currentPlayerId(state) !== playerId) throw new Error('NOT_YOUR_TURN')
  const withCabo: GameState = {
    ...state,
    caboCallerId: playerId,
    phase: 'cabo-called',
    turnsRemaining: state.players.length - 1,
    log: [...state.log, { timestamp: Date.now(), type: 'cabo', actorId: playerId }],
  }
  const nextTurn = (withCabo.turn + 1) % withCabo.players.length
  return { ...withCabo, turn: nextTurn }
}

export function finishRound(state: GameState): GameState {
  if (state.phase !== 'round-end') throw new Error('INVALID_PHASE')
  const matchEnd = isMatchEnd(state.players)
  return {
    ...state,
    players: state.players.map(p => ({ ...p, hand: [] })),
    deck: [],
    discard: [],
    phase: matchEnd ? 'match-end' : 'waiting',
    caboCallerId: null,
    turnsRemaining: null,
    pendingEffect: null,
    snapWindow: null,
    log: [...state.log, { timestamp: Date.now(), type: 'round-end', actorId: state.caboCallerId ?? '' }],
  }
}
