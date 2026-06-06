import { describe, it, expect } from 'vitest'
import { createEmptyRoom, trimLog } from '@/server/game/state'
import { redactStateForPlayer } from '@/server/game/redact'
import type { GameAction } from '@/types/shared'

const makeLog = (n: number): GameAction[] =>
  Array.from({ length: n }, (_, i) => ({ timestamp: i, type: 'draw' as const, actorId: 'p1' }))

describe('cap do log de acoes', () => {
  it('trimLog mantem apenas as ultimas N entradas', () => {
    const trimmed = trimLog(makeLog(100), 40)
    expect(trimmed).toHaveLength(40)
    expect(trimmed[0]?.timestamp).toBe(60)
  })

  it('trimLog nao mexe em logs menores que o limite', () => {
    const log = makeLog(5)
    expect(trimLog(log, 40)).toBe(log)
  })

  it('redactStateForPlayer limita o log do broadcast a 40', () => {
    const base = createEmptyRoom({ roomId: 'r1', name: 'M', hostId: 'p1', hostName: 'Ana', maxPlayers: 4 })
    const redacted = redactStateForPlayer({ ...base, log: makeLog(120) }, 'p1')
    expect(redacted.log).toHaveLength(40)
  })
})
