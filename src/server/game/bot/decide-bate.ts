import type { BotLevel } from '@/types/shared'
import type { BotView } from './belief'
import { CARD_VALUES } from '../scoring'
import { LEVEL_CONFIG, UNKNOWN_CARD_EV } from './config'

export function estimateHand(view: BotView): number {
  return view.myHand.reduce((sum, s) => sum + (s.rank !== null ? CARD_VALUES[s.rank] : UNKNOWN_CARD_EV), 0)
}

export function decideBate(view: BotView, level: BotLevel): boolean {
  if (view.bateCallerId !== null) return false
  return estimateHand(view) <= LEVEL_CONFIG[level].bateThreshold
}
