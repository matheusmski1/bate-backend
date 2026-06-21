import { describe, it, expect } from 'vitest'
import { decideTurn } from '@/server/game/bot/decide-turn'
import type { BotView } from '@/server/game/bot/belief'
import { card } from './fixtures'

function view(myHand: BotView['myHand']): BotView {
  return { myId: 'b', myHand, opponents: [{ id: 'o', hand: [{ cardId: 'o0', index: 0, rank: null }] }], topDiscard: null, deckCount: 50, phase: 'playing', bateCallerId: null }
}

describe('decideTurn', () => {
  it('troca carta alta conhecida por carta baixa comprada', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'J' }, { cardId: 'c1', index: 1, rank: '3' }])
    expect(decideTurn(v, card('drawn', '2'), 'medium')).toEqual({ kind: 'swap', handIndex: 0 })
  })

  it('descarta a carta comprada quando ela e pior que tudo que tenho', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '2' }, { cardId: 'c1', index: 1, rank: '3' }])
    const d = decideTurn(v, card('drawn', 'J'), 'medium')
    expect(d).toEqual({ kind: 'discard', useEffect: false })
  })

  it('nunca descarta K ou JOKER comprado — guarda no lugar de uma desconhecida', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }, { cardId: 'c1', index: 1, rank: null }])
    expect(decideTurn(v, card('drawn', 'K'), 'medium').kind).toBe('swap')
    expect(decideTurn(v, card('drawn', 'JOKER', null), 'medium').kind).toBe('swap')
  })

  it('facil ignora a oportunidade de trocar numa carta desconhecida positiva', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }, { cardId: 'c1', index: 1, rank: null }])
    expect(decideTurn(v, card('drawn', '4'), 'easy').kind).toBe('discard')
  })

  it('facil guarda K comprado mesmo com a mao toda desconhecida', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }, { cardId: 'c1', index: 1, rank: null }])
    expect(decideTurn(v, card('drawn', 'K'), 'easy')).toEqual({ kind: 'swap', handIndex: 0 })
  })

  it('descarta carta de efeito usando o efeito quando ha slot a explorar (medio)', () => {
    const known = view([{ cardId: 'c0', index: 0, rank: 'A' }, { cardId: 'c1', index: 1, rank: null }])
    const d = decideTurn(known, card('drawn', 'J'), 'medium')
    expect(d).toEqual({ kind: 'discard', useEffect: true })
  })

  it('guarda K comprado trocando pela melhor conhecida quando nao ha slot desconhecido', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'K' }, { cardId: 'c1', index: 1, rank: 'JOKER' }])
    expect(decideTurn(v, card('drawn', 'K'), 'medium')).toEqual({ kind: 'swap', handIndex: 0 })
  })
})
