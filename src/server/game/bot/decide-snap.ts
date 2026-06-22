import type { BotLevel } from '@/types/shared'
import type { BotView } from './belief'
import { LEVEL_CONFIG } from './config'

export function decideSnap(view: BotView, level: BotLevel, rng: () => number = Math.random): number | null {
  const top = view.topDiscard
  if (!top) return null
  const match = view.myHand.find(s => s.rank === top.rank)
  if (!match) return null
  if (rng() >= LEVEL_CONFIG[level].snapAccuracy) return null
  return match.index
}
