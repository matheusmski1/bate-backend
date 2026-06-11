import { describe, it, expect } from 'vitest'
import { boardRevealSnapshot, isEndPhase, isBoardPhase } from '@/server/game/state'
import type { GameState } from '@/types/shared'

function endState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [
      { id: 'p1', socketId: null, name: 'A', hand: [], score: 5, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [], score: 9, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ],
    pendingJoins: [], deck: [], discard: [], turn: 0, phase: 'round-end',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null, snapWindow: null,
    log: [
      { timestamp: 1, type: 'discard', actorId: 'p1' },
      { timestamp: 2, type: 'round-end', actorId: '', payload: { reason: 'deck-empty' } },
    ],
    createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: 123456, paused: false, pausedRemainingMs: null,
    roundTurnCount: 4, roundNumber: 2, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

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
  })

  it('initial-peek não conta como fase de tabuleiro (exclusão intencional)', () => {
    expect(isBoardPhase('initial-peek')).toBe(false)
  })
})

describe('boardRevealSnapshot', () => {
  it('volta a fase pro tabuleiro, zera o timer e mantém o resto', () => {
    const snap = boardRevealSnapshot(endState(), 'bate-called')
    expect(snap.phase).toBe('bate-called')
    expect(snap.turnDeadlineAt).toBeNull()
    expect(snap.players[1]!.score).toBe(9)
    expect(snap.roundNumber).toBe(2)
  })

  it('remove a entrada de log round-end do final pra não disparar som de vitória cedo', () => {
    const snap = boardRevealSnapshot(endState(), 'playing')
    expect(snap.log).toHaveLength(1)
    expect(snap.log[snap.log.length - 1]!.type).toBe('discard')
  })

  it('não quebra com log vazio', () => {
    const snap = boardRevealSnapshot(endState({ log: [] }), 'playing')
    expect(snap.log).toHaveLength(0)
  })

  it('não mexe no log quando a última entrada não é round-end (caso bate)', () => {
    const noEndLog = endState({ log: [{ timestamp: 1, type: 'discard', actorId: 'p2' }] })
    const snap = boardRevealSnapshot(noEndLog, 'bate-called')
    expect(snap.log).toHaveLength(1)
    expect(snap.log[0]!.type).toBe('discard')
  })
})
