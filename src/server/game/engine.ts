import type { Card, GameState, GameAction, GameActionType } from '@/types/shared'
import { scoreHand, isMatchEnd } from './scoring'

const SNAP_WINDOW_MS = 3000
const FINAL_SNAP_WINDOW_MS = Number(process.env.FINAL_SNAP_WINDOW_MS ?? 2500)
const MAX_HAND_SIZE = 10

function logEvent(state: GameState, type: GameActionType, actorId: string, payload?: Record<string, unknown>): GameAction[] {
  return [...state.log, { timestamp: Date.now(), type, actorId, payload }]
}

function currentPlayerId(state: GameState): string {
  return state.players[state.turn]!.id
}

function nextDeadline(state: GameState): number | null {
  if (state.turnTimeLimitSec === null || state.turnTimeLimitSec <= 0) return null
  return Date.now() + state.turnTimeLimitSec * 1000
}

function withFreshTurnTimer(state: GameState): GameState {
  if (state.phase !== 'playing' && state.phase !== 'bate-called') {
    return { ...state, turnDeadlineAt: null, paused: false, pausedRemainingMs: null }
  }
  return { ...state, turnDeadlineAt: nextDeadline(state), paused: false, pausedRemainingMs: null }
}

function advanceTurn(state: GameState): GameState {
  const nextTurn = (state.turn + 1) % state.players.length
  if (state.phase === 'bate-called' && state.turnsRemaining !== null) {
    const turnsRemaining = state.turnsRemaining - 1
    if (turnsRemaining <= 0) {
      return openFinalSnapWindow({ ...state, turn: nextTurn, turnsRemaining: 0, roundTurnCount: state.roundTurnCount + 1 })
    }
    return withFreshTurnTimer({ ...state, turn: nextTurn, turnsRemaining, roundTurnCount: state.roundTurnCount + 1 })
  }
  return withFreshTurnTimer({ ...state, turn: nextTurn, roundTurnCount: state.roundTurnCount + 1 })
}

export function drawFromDeck(state: GameState, playerId: string): { state: GameState; card: Card | null } {
  if (state.phase !== 'playing' && state.phase !== 'bate-called') {
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

export function removePlayerMidGame(state: GameState, playerId: string): GameState {
  const idx = state.players.findIndex(p => p.id === playerId)
  if (idx === -1) return state
  const players = state.players.filter(p => p.id !== playerId)
  if (players.length < 2) {
    if (players.length === 0) return state
    const scored = players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
    return {
      ...state,
      players: scored,
      phase: isMatchEnd(scored) ? 'match-end' : 'round-end',
      pendingEffect: null,
      snapWindow: null,
      log: [...state.log, { timestamp: Date.now(), type: 'leave', actorId: playerId, payload: { reason: 'last-player-left' } }],
    }
  }
  let nextTurn = state.turn
  if (state.turn === idx) {
    nextTurn = state.turn % players.length
  } else if (state.turn > idx) {
    nextTurn = state.turn - 1
  }
  let phase = state.phase
  let bateCallerId = state.bateCallerId
  let turnsRemaining = state.turnsRemaining
  let pendingEffect = state.pendingEffect
  if (bateCallerId === playerId) {
    bateCallerId = null
    turnsRemaining = null
    if (phase === 'bate-called') phase = 'playing'
  }
  if (pendingEffect && pendingEffect.playerId === playerId) {
    pendingEffect = null
    if (phase === 'effect-pending') phase = bateCallerId !== null ? 'bate-called' : 'playing'
  }
  let hostId = state.hostId
  if (hostId === playerId) {
    const nextHost = players.find(p => p.connected) ?? players[0]
    if (nextHost) hostId = nextHost.id
  }
  return {
    ...state,
    players,
    turn: nextTurn,
    phase,
    hostId,
    bateCallerId,
    turnsRemaining,
    pendingEffect,
    log: [...state.log, { timestamp: Date.now(), type: 'leave', actorId: playerId }],
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

export function discardDrawnCard(state: GameState, playerId: string, card: Card, useEffect = true): GameState {
  if (currentPlayerId(state) !== playerId) {
    throw new Error('NOT_YOUR_TURN')
  }
  const discard = [...state.discard, { ...card, discardedBy: playerId }]
  const pendingEffect = useEffect ? effectFromRank(card, playerId) : null
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
  const discard = [...state.discard, { ...oldCard, discardedBy: playerId }]
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
  if (state.phase !== 'playing' && state.phase !== 'bate-called') {
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
    const afterSnap: GameState = {
      ...state,
      players,
      discard: [...state.discard, { ...snappedCard, discardedBy: playerId }],
      log: [...state.log, { timestamp: Date.now(), type: 'snap', actorId: playerId, payload: { cardId: snappedCard.id, rank: snappedCard.rank } }],
    }
    if (newHand.length === 0 && state.bateCallerId === null) {
      return {
        ...afterSnap,
        bateCallerId: playerId,
        phase: 'bate-called',
        turnsRemaining: state.players.length - 1,
        log: [...afterSnap.log, { timestamp: Date.now(), type: 'bate', actorId: playerId, payload: { reason: 'empty-hand' } }],
      }
    }
    return afterSnap
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
  const restoredPhase: GameState['phase'] = state.bateCallerId !== null ? 'bate-called' : 'playing'

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
  const restoredPhase: GameState['phase'] = state.bateCallerId !== null ? 'bate-called' : 'playing'
  const cleared: GameState = {
    ...state,
    pendingEffect: null,
    phase: restoredPhase,
    log: [...state.log, { timestamp: Date.now(), type: 'peek', actorId: playerId, payload: { skipped: true } }],
  }
  return advanceTurnExported(cleared)
}

function advanceTurnExported(state: GameState): GameState {
  return advanceTurn(state)
}

export function pauseTimer(state: GameState): GameState {
  if (state.paused) return state
  if (state.turnDeadlineAt === null) return state
  const remaining = Math.max(0, state.turnDeadlineAt - Date.now())
  return { ...state, paused: true, pausedRemainingMs: remaining, turnDeadlineAt: null }
}

export function resumeTimer(state: GameState): GameState {
  if (!state.paused) return state
  const ms = state.pausedRemainingMs ?? (state.turnTimeLimitSec ?? 60) * 1000
  return { ...state, paused: false, pausedRemainingMs: null, turnDeadlineAt: Date.now() + ms }
}

export function startTurnTimer(state: GameState): GameState {
  return withFreshTurnTimer(state)
}

export function callBate(state: GameState, playerId: string): GameState {
  if (state.bateCallerId !== null) throw new Error('BATE_ALREADY_CALLED')
  if (state.phase !== 'playing') throw new Error('INVALID_PHASE')
  if (currentPlayerId(state) !== playerId) throw new Error('NOT_YOUR_TURN')
  const withBate: GameState = {
    ...state,
    bateCallerId: playerId,
    phase: 'bate-called',
    turnsRemaining: state.players.length - 1,
    log: [...state.log, { timestamp: Date.now(), type: 'bate', actorId: playerId }],
  }
  const nextTurn = (withBate.turn + 1) % withBate.players.length
  return withFreshTurnTimer({ ...withBate, turn: nextTurn, roundTurnCount: withBate.roundTurnCount + 1 })
}

export function autoPlayExpiredTurn(state: GameState): { state: GameState; reason: 'auto-discard' | 'auto-draw-discard' | 'noop' } {
  if (state.phase !== 'playing' && state.phase !== 'bate-called') return { state, reason: 'noop' }
  const playerId = state.players[state.turn]?.id
  if (!playerId) return { state, reason: 'noop' }
  if (state.deck.length === 0) return { state: endRoundEmptyDeck(state), reason: 'noop' }
  const deckAfter = [...state.deck]
  const card = deckAfter.pop()!
  const afterDraw: GameState = { ...state, deck: deckAfter, log: logEvent(state, 'draw', playerId, { auto: true }) }
  const discard = [...afterDraw.discard, card]
  const log2 = logEvent(afterDraw, 'discard', playerId, { cardId: card.id, rank: card.rank, auto: true })
  const next = advanceTurn({ ...afterDraw, discard, log: log2, snapWindow: null })
  return { state: next, reason: 'auto-draw-discard' }
}

export function tallyRound(state: GameState): GameState {
  const players = state.players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
  return {
    ...state,
    players,
    phase: isMatchEnd(players) ? 'match-end' : 'round-end',
    snapWindow: null,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    log: [...state.log, { timestamp: Date.now(), type: 'round-end', actorId: '', payload: { reason: 'bate' } }],
  }
}

export function openFinalSnapWindow(state: GameState, windowMs: number = FINAL_SNAP_WINDOW_MS): GameState {
  const top = state.discard[state.discard.length - 1]
  return {
    ...state,
    phase: 'final-snap',
    turnsRemaining: 0,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    snapWindow: top ? { openedAt: Date.now(), durationMs: windowMs, discardedCardId: top.id } : null,
  }
}

export function extendFinalSnapWindow(state: GameState, extendMs: number): GameState {
  if (!state.snapWindow) return state
  return { ...state, snapWindow: { ...state.snapWindow, openedAt: Date.now(), durationMs: extendMs } }
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
    bateCallerId: null,
    turnsRemaining: null,
    pendingEffect: null,
    snapWindow: null,
    log: [...state.log, { timestamp: Date.now(), type: 'round-end', actorId: state.bateCallerId ?? '' }],
  }
}
