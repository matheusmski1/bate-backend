import { describe, it, expect } from 'vitest'
import { decideEffect } from '@/server/game/bot/decide-effect'
import type { BotView } from '@/server/game/bot/belief'

function view(myHand: BotView['myHand'], oppHand: BotView['myHand']): BotView {
  return { myId: 'b', myHand, opponents: [{ id: 'o', hand: oppHand }], topDiscard: null, deckCount: 50, phase: 'effect-pending', bateCallerId: null }
}

describe('decideEffect', () => {
  it('peek-own espia a primeira carta propria desconhecida', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '3' }, { cardId: 'c1', index: 1, rank: null }], [])
    expect(decideEffect(v, 'peek-own', 'medium')).toEqual({ targetPlayerId: 'b', targetCardIndex: 1 })
  })

  it('peek-other espia carta desconhecida do oponente', () => {
    const v = view([], [{ cardId: 'o0', index: 0, rank: null }])
    expect(decideEffect(v, 'peek-other', 'medium')).toEqual({ targetPlayerId: 'o', targetCardIndex: 0 })
  })

  it('swap troca minha carta alta conhecida pela baixa conhecida do oponente', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'Q' }], [{ cardId: 'o0', index: 0, rank: '2' }])
    expect(decideEffect(v, 'swap', 'medium')).toEqual({ targetPlayerId: 'o', targetCardIndex: 0, myCardIndex: 0 })
  })

  it('swap pula (null) quando nao ha ganho de troca', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '2' }], [{ cardId: 'o0', index: 0, rank: 'Q' }])
    expect(decideEffect(v, 'swap', 'medium')).toBeNull()
  })
})
