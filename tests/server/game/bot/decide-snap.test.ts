import { describe, it, expect } from 'vitest'
import { decideSnap } from '@/server/game/bot/decide-snap'
import type { BotView } from '@/server/game/bot/belief'
import { card } from './fixtures'

function view(myHand: BotView['myHand'], topRank: 'A' | '5' | 'K'): BotView {
  return { myId: 'b', myHand, opponents: [], topDiscard: card('top', topRank), deckCount: 50, phase: 'playing', bateCallerId: null }
}

describe('decideSnap', () => {
  it('da snap quando conhece carta de rank igual ao topo do descarte', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'K' }, { cardId: 'c1', index: 1, rank: '5' }], '5')
    expect(decideSnap(v, 'hard', () => 0)).toBe(1)
  })

  it('nao da snap em carta desconhecida mesmo que pudesse casar', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }], '5')
    expect(decideSnap(v, 'hard', () => 0)).toBeNull()
  })

  it('facil ignora parte das chances (rng acima da precisao)', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '5' }], '5')
    expect(decideSnap(v, 'easy', () => 0.5)).toBeNull()
    expect(decideSnap(v, 'hard', () => 0.5)).toBe(0)
  })
})
