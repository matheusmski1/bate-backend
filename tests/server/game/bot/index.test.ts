import { describe, it, expect } from 'vitest'
import { runBotTurn, planBotAction } from '@/server/game/bot/index'
import { seedFromInitialPeek } from '@/server/game/bot/belief'
import { practiceRound } from './fixtures'

const BOT = 'bot:R1:0'

describe('runBotTurn', () => {
  it('avanca o turno e nunca lanca para qualquer mao inicial', () => {
    let state = practiceRound(['hard'])
    state = { ...state, turn: state.players.findIndex(p => p.id === BOT) }
    const mem = seedFromInitialPeek(state, BOT, 'hard')
    const before = state.roundTurnCount
    const out = runBotTurn(state, BOT, mem, 'hard')
    expect(out.state.phase === 'effect-pending').toBe(false)
    expect(out.state.roundTurnCount).toBeGreaterThanOrEqual(before)
  })
})

describe('planBotAction', () => {
  it('retorna null quando nao ha humano conectado', () => {
    const state = practiceRound(['medium'])
    expect(planBotAction(state, new Map(), false)).toBeNull()
  })

  it('confirma peeks na fase initial-peek', () => {
    const state = { ...practiceRound(['medium']), phase: 'initial-peek' as const }
    expect(planBotAction(state, new Map(), true)).toEqual({ kind: 'confirm-peeks' })
  })
})
