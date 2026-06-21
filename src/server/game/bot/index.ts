import type { GameState, BotLevel, Player } from '@/types/shared'
import {
  drawFromDeck, swapAndDiscard, discardDrawnCard, resolveEffect, skipEffect, callBate,
} from '../engine'
import { buildBotView, learnCard, type BotMemory } from './belief'
import { decideTurn } from './decide-turn'
import { decideEffect } from './decide-effect'
import { decideSnap } from './decide-snap'
import { decideBate } from './decide-bate'

function botPlayers(state: GameState): Player[] {
  return state.players.filter(p => p.isBot)
}

function levelOf(player: Player | undefined): BotLevel {
  return player?.botLevel ?? 'medium'
}

export function runBotTurn(
  state: GameState, botId: string, mem: BotMemory, level: BotLevel, rng: () => number = Math.random,
): { state: GameState; memory: BotMemory } {
  let memory = mem

  if (state.phase === 'playing') {
    const view = buildBotView(state, botId, memory, level)
    if (decideBate(view, level)) {
      return { state: callBate(state, botId), memory }
    }
  }

  const drawn = drawFromDeck(state, botId)
  if (!drawn.card) return { state: drawn.state, memory }
  let next = drawn.state
  const card = drawn.card

  const view = buildBotView(next, botId, memory, level)
  const decision = decideTurn(view, card, level)
  next = decision.kind === 'swap'
    ? swapAndDiscard(next, botId, card, decision.handIndex)
    : discardDrawnCard(next, botId, card, decision.kind === 'discard' && decision.useEffect)

  if (next.phase === 'effect-pending' && next.pendingEffect?.playerId === botId) {
    const effectType = next.pendingEffect.type
    if (!levelUsesEffects(level)) {
      next = skipEffect(next, botId)
    } else {
      const evView = buildBotView(next, botId, memory, level)
      const input = decideEffect(evView, effectType, level)
      if (!input) {
        next = skipEffect(next, botId)
      } else {
        const resolved = resolveEffect(next, botId, input)
        next = resolved.state
        for (const r of resolved.revealed) {
          memory = learnCard(memory, r.card.id, r.card.rank, state.roundTurnCount)
        }
      }
    }
  }

  return { state: next, memory }
}

function levelUsesEffects(level: BotLevel): boolean {
  return level !== 'easy'
}

export type PlannedAction =
  | { kind: 'confirm-peeks' }
  | { kind: 'snap'; botId: string; handIndex: number }
  | { kind: 'turn'; botId: string }
  | null

export function planBotAction(
  state: GameState,
  memories: Map<string, BotMemory>,
  hasConnectedHuman: boolean,
  rng: () => number = Math.random,
): PlannedAction {
  if (!hasConnectedHuman || state.paused) return null
  if (botPlayers(state).length === 0) return null

  if (state.phase === 'initial-peek') return { kind: 'confirm-peeks' }

  if (state.phase === 'playing' || state.phase === 'bate-called' || state.phase === 'final-snap') {
    const top = state.discard[state.discard.length - 1]
    if (top) {
      for (const bot of botPlayers(state)) {
        const botMem = memories.get(bot.id)
        if (!botMem || botMem.lastSnapDiscardId === top.id) continue
        const view = buildBotView(state, bot.id, botMem, levelOf(bot))
        const handIndex = decideSnap(view, levelOf(bot), rng)
        if (handIndex !== null) return { kind: 'snap', botId: bot.id, handIndex }
      }
    }
  }

  if (state.phase === 'playing' || state.phase === 'bate-called') {
    const current = state.players[state.turn]
    if (current?.isBot) return { kind: 'turn', botId: current.id }
  }

  return null
}
