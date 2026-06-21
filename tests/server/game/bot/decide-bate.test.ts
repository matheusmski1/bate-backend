import { describe, it, expect } from 'vitest'
import { decideBate, estimateHand } from '@/server/game/bot/decide-bate'
import type { BotView } from '@/server/game/bot/belief'

function view(myHand: BotView['myHand'], bateCallerId: string | null = null): BotView {
  return { myId: 'b', myHand, opponents: [], topDiscard: null, deckCount: 50, phase: 'playing', bateCallerId }
}

describe('decideBate', () => {
  it('estima carta desconhecida pelo valor esperado', () => {
    const e = estimateHand(view([{ cardId: 'c0', index: 0, rank: null }]))
    expect(e).toBeCloseTo(576 / 108, 6)
  })

  it('dificil bate com mao 7, facil nao (limiar 8 vs 4)', () => {
    const hand: BotView['myHand'] = [{ cardId: 'a', index: 0, rank: '3' }, { cardId: 'b', index: 1, rank: '4' }]
    expect(decideBate(view(hand), 'hard')).toBe(true)
    expect(decideBate(view(hand), 'easy')).toBe(false)
  })

  it('nao bate se o bate ja foi chamado', () => {
    const hand: BotView['myHand'] = [{ cardId: 'a', index: 0, rank: 'K' }]
    expect(decideBate(view(hand, 'someoneElse'), 'hard')).toBe(false)
  })
})
