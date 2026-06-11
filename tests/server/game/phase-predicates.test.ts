import { describe, it, expect } from 'vitest'
import { isEndPhase, isBoardPhase } from '@/server/game/state'

describe('isEndPhase / isBoardPhase', () => {
  it('classifica fases de fim e de tabuleiro', () => {
    expect(isEndPhase('round-end')).toBe(true)
    expect(isEndPhase('match-end')).toBe(true)
    expect(isEndPhase('playing')).toBe(false)
    expect(isBoardPhase('playing')).toBe(true)
    expect(isBoardPhase('bate-called')).toBe(true)
    expect(isBoardPhase('effect-pending')).toBe(true)
    expect(isBoardPhase('waiting')).toBe(false)
    expect(isBoardPhase('round-end')).toBe(false)
    expect(isBoardPhase('final-snap')).toBe(true)
    expect(isEndPhase('final-snap')).toBe(false)
  })

  it('initial-peek não conta como fase de tabuleiro (exclusão intencional)', () => {
    expect(isBoardPhase('initial-peek')).toBe(false)
  })
})
