import type { Card, BotLevel } from '@/types/shared'
import type { BotView } from './belief'
import { CARD_VALUES } from '../scoring'
import { LEVEL_CONFIG, UNKNOWN_CARD_EV } from './config'

export type TurnDecision =
  | { kind: 'swap'; handIndex: number }
  | { kind: 'discard'; useEffect: boolean }

const EFFECT_RANKS = new Set(['10', 'J', 'Q'])

function effectiveValue(rank: BotView['myHand'][number]['rank'], considerUnknown: boolean): number | null {
  if (rank !== null) return CARD_VALUES[rank]
  return considerUnknown ? UNKNOWN_CARD_EV : null
}

function bestKnownSlot(view: BotView): BotView['myHand'][number] | undefined {
  return view.myHand.filter(s => s.rank !== null).sort((a, b) => CARD_VALUES[b.rank!] - CARD_VALUES[a.rank!])[0]
}

export function decideTurn(view: BotView, drawn: Card, level: BotLevel): TurnDecision {
  const cfg = LEVEL_CONFIG[level]
  const drawnValue = CARD_VALUES[drawn.rank]

  let best: { index: number; value: number } | null = null
  for (const slot of view.myHand) {
    const value = effectiveValue(slot.rank, cfg.considerUnknownSwap)
    if (value === null) continue
    if (value > drawnValue && (best === null || value > best.value)) {
      best = { index: slot.index, value }
    }
  }

  if (best) return { kind: 'swap', handIndex: best.index }

  if (drawnValue < 0) {
    const target = view.myHand.find(s => s.rank === null) ?? bestKnownSlot(view)
    if (target) return { kind: 'swap', handIndex: target.index }
  }

  const hasUnknownSlot = view.myHand.some(s => s.rank === null)
  const useEffect = cfg.useEffects && EFFECT_RANKS.has(drawn.rank) && hasUnknownSlot
  return { kind: 'discard', useEffect }
}
