import { describe, it, expect } from 'vitest'
import { seedFromInitialPeek, learnCard, knownRank, buildBotView, emptyMemory } from '@/server/game/bot/belief'
import { practiceRound, setHand, card } from './fixtures'

const BOT = 'bot:R1:0'

describe('seedFromInitialPeek', () => {
  it('semeia as 2 cartas reveladas no medio', () => {
    let state = practiceRound(['medium'])
    state = setHand(state, BOT, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    const mem = seedFromInitialPeek(state, BOT, 'medium')
    expect(knownRank(mem, 'c2', 1, 'medium')).toBe('5')
    expect(knownRank(mem, 'c3', 1, 'medium')).toBe('2')
    expect(knownRank(mem, 'c0', 1, 'medium')).toBeNull()
  })

  it('semeia apenas 1 das 2 no facil', () => {
    let state = practiceRound(['easy'])
    state = setHand(state, BOT, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    const mem = seedFromInitialPeek(state, BOT, 'easy')
    const knownCount = ['c2', 'c3'].filter(id => knownRank(mem, id, 1, 'easy') !== null).length
    expect(knownCount).toBe(1)
  })
})

describe('knownRank + decay', () => {
  it('facil esquece carta aprendida ha mais de 2 turnos', () => {
    const mem = learnCard(emptyMemory(), 'x', 'Q', 1)
    expect(knownRank(mem, 'x', 2, 'easy')).toBe('Q')
    expect(knownRank(mem, 'x', 3, 'easy')).toBe('Q')
    expect(knownRank(mem, 'x', 4, 'easy')).toBeNull()
  })

  it('medio nunca esquece', () => {
    const mem = learnCard(emptyMemory(), 'x', 'Q', 1)
    expect(knownRank(mem, 'x', 50, 'medium')).toBe('Q')
  })

  it('dificil nunca esquece', () => {
    const mem = learnCard(emptyMemory(), 'x', 'Q', 1)
    expect(knownRank(mem, 'x', 50, 'hard')).toBe('Q')
  })

  it('learnCard atualiza o rank de uma carta ja conhecida', () => {
    let mem = learnCard(emptyMemory(), 'x', 'Q', 1)
    mem = learnCard(mem, 'x', 'K', 3)
    expect(knownRank(mem, 'x', 3, 'medium')).toBe('K')
  })
})

describe('buildBotView', () => {
  it('expoe rank apenas das cartas conhecidas, esconde o resto', () => {
    let state = practiceRound(['medium'])
    state = setHand(state, BOT, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    const mem = seedFromInitialPeek(state, BOT, 'medium')
    const view = buildBotView(state, BOT, mem, 'medium')
    const known = view.myHand.filter(s => s.rank !== null).map(s => s.cardId).sort()
    expect(known).toEqual(['c2', 'c3'])
    expect(view.opponents[0]!.hand.every(s => s.rank === null)).toBe(true)
  })
})
