import { describe, it, expect } from 'vitest'
import { UNKNOWN_CARD_EV, LEVEL_CONFIG } from '@/server/game/bot/config'

describe('config do bot', () => {
  it('valor esperado de carta desconhecida e 576/108 (~5.333)', () => {
    expect(UNKNOWN_CARD_EV).toBeCloseTo(576 / 108, 6)
  })

  it('facil esquece (memoryTurns finito), medio e dificil nunca esquecem', () => {
    expect(LEVEL_CONFIG.easy.memoryTurns).toBe(2)
    expect(LEVEL_CONFIG.medium.memoryTurns).toBe(Infinity)
    expect(LEVEL_CONFIG.hard.memoryTurns).toBe(Infinity)
  })

  it('dificil bate com mao mais alta que facil (limiar maior)', () => {
    expect(LEVEL_CONFIG.hard.bateThreshold).toBeGreaterThan(LEVEL_CONFIG.easy.bateThreshold)
  })
})
