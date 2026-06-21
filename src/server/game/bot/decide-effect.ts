import type { BotLevel, EffectType } from '@/types/shared'
import type { BotView, BotSlot } from './belief'
import { CARD_VALUES } from '../scoring'

export type EffectInput = { targetPlayerId: string; targetCardIndex: number; myCardIndex?: number }

function firstUnknown(hand: BotSlot[]): BotSlot | undefined {
  return hand.find(s => s.rank === null)
}

function highestKnown(hand: BotSlot[]): BotSlot | undefined {
  return hand.filter(s => s.rank !== null).sort((a, b) => CARD_VALUES[b.rank!] - CARD_VALUES[a.rank!])[0]
}

function lowestKnown(hand: BotSlot[]): BotSlot | undefined {
  return hand.filter(s => s.rank !== null).sort((a, b) => CARD_VALUES[a.rank!] - CARD_VALUES[b.rank!])[0]
}

export function decideEffect(view: BotView, effectType: EffectType, _level: BotLevel): EffectInput | null {
  if (effectType === 'peek-own') {
    const slot = firstUnknown(view.myHand)
    return slot ? { targetPlayerId: view.myId, targetCardIndex: slot.index } : null
  }

  if (effectType === 'peek-other') {
    for (const opp of view.opponents) {
      const slot = firstUnknown(opp.hand)
      if (slot) return { targetPlayerId: opp.id, targetCardIndex: slot.index }
    }
    return null
  }

  const mine = highestKnown(view.myHand)
  if (!mine || mine.rank === null) return null
  for (const opp of view.opponents) {
    const theirs = lowestKnown(opp.hand)
    if (theirs && theirs.rank !== null && CARD_VALUES[theirs.rank] < CARD_VALUES[mine.rank]) {
      return { targetPlayerId: opp.id, targetCardIndex: theirs.index, myCardIndex: mine.index }
    }
  }
  return null
}
