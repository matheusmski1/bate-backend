import type { GameState, BotLevel, Rank, Card, GamePhase } from '@/types/shared'
import { LEVEL_CONFIG } from './config'

export type BotMemory = {
  known: { cardId: string; rank: Rank; turn: number }[]
  lastSnapDiscardId: string | null
}

export function emptyMemory(): BotMemory {
  return { known: [], lastSnapDiscardId: null }
}

export function learnCard(mem: BotMemory, cardId: string, rank: Rank, turn: number): BotMemory {
  const known = mem.known.filter(k => k.cardId !== cardId)
  known.push({ cardId, rank, turn })
  return { ...mem, known }
}

export function seedFromInitialPeek(state: GameState, botId: string, level: BotLevel): BotMemory {
  const bot = state.players.find(p => p.id === botId)
  if (!bot) return emptyMemory()
  const turn = state.roundTurnCount
  const ids = bot.revealedToSelf.slice(0, LEVEL_CONFIG[level].seedInitialCount)
  let mem = emptyMemory()
  for (const id of ids) {
    const c = bot.hand.find(h => h.id === id)
    if (c) mem = learnCard(mem, c.id, c.rank, turn)
  }
  return mem
}

export function pruneAbsent(mem: BotMemory, state: GameState): BotMemory {
  const present = new Set(state.players.flatMap(p => p.hand.map(c => c.id)))
  return { ...mem, known: mem.known.filter(k => present.has(k.cardId)) }
}

export function knownRank(mem: BotMemory, cardId: string, currentTurn: number, level: BotLevel): Rank | null {
  const entry = mem.known.find(k => k.cardId === cardId)
  if (!entry) return null
  const window = LEVEL_CONFIG[level].memoryTurns
  if (Number.isFinite(window) && currentTurn - entry.turn > window) return null
  return entry.rank
}

export type BotSlot = { cardId: string; index: number; rank: Rank | null }

export type BotView = {
  myId: string
  myHand: BotSlot[]
  opponents: { id: string; hand: BotSlot[] }[]
  topDiscard: Card | null
  deckCount: number
  phase: GamePhase
  bateCallerId: string | null
}

export function buildBotView(state: GameState, botId: string, mem: BotMemory, level: BotLevel): BotView {
  const turn = state.roundTurnCount
  const toSlots = (hand: Card[]): BotSlot[] =>
    hand.map((c, index) => ({ cardId: c.id, index, rank: knownRank(mem, c.id, turn, level) }))
  const me = state.players.find(p => p.id === botId)
  return {
    myId: botId,
    myHand: me ? toSlots(me.hand) : [],
    opponents: state.players.filter(p => p.id !== botId).map(p => ({ id: p.id, hand: toSlots(p.hand) })),
    topDiscard: state.discard[state.discard.length - 1] ?? null,
    deckCount: state.deck.length,
    phase: state.phase,
    bateCallerId: state.bateCallerId,
  }
}
