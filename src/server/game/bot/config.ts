import type { BotLevel, Rank } from '@/types/shared'
import { CARD_VALUES } from '../scoring'

const STANDARD_RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const STANDARD_COPIES = 8
const JOKER_COPIES = 4
const DECK_TOTAL = STANDARD_RANKS.length * STANDARD_COPIES + JOKER_COPIES
const DECK_VALUE_SUM =
  STANDARD_RANKS.reduce((sum, r) => sum + CARD_VALUES[r] * STANDARD_COPIES, 0) +
  CARD_VALUES.JOKER * JOKER_COPIES

export const UNKNOWN_CARD_EV = DECK_VALUE_SUM / DECK_TOTAL

export type LevelConfig = {
  considerUnknownSwap: boolean
  useEffects: boolean
  snapAccuracy: number
  bateThreshold: number
  memoryTurns: number
  seedInitialCount: 1 | 2
  thinkMs: [number, number]
}

export const LEVEL_CONFIG: Record<BotLevel, LevelConfig> = {
  easy: { considerUnknownSwap: false, useEffects: false, snapAccuracy: 0.4, bateThreshold: 4, memoryTurns: 2, seedInitialCount: 1, thinkMs: [1500, 2500] },
  medium: { considerUnknownSwap: true, useEffects: true, snapAccuracy: 0.8, bateThreshold: 6, memoryTurns: Infinity, seedInitialCount: 2, thinkMs: [1000, 1500] },
  hard: { considerUnknownSwap: true, useEffects: true, snapAccuracy: 1.0, bateThreshold: 8, memoryTurns: Infinity, seedInitialCount: 2, thinkMs: [500, 1000] },
}
