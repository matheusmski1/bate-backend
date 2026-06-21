import { describe, it, expect } from 'vitest'
import { parsePayload, GameEffectTargetSchema } from '@/server/handlers/schemas'

const HUMAN = '11111111-1111-4111-8111-111111111111'

describe('GameEffectTargetSchema', () => {
  it('aceita targetPlayerId de bot (bot:<roomId>:<n>)', () => {
    const r = parsePayload(GameEffectTargetSchema, {
      roomId: 'ABC123', playerId: HUMAN, targetPlayerId: 'bot:ABC123:0', targetCardIndex: 0,
    })
    expect(r.ok).toBe(true)
  })

  it('aceita targetPlayerId de humano (uuid)', () => {
    const r = parsePayload(GameEffectTargetSchema, {
      roomId: 'ABC123', playerId: HUMAN, targetPlayerId: '22222222-2222-4222-8222-222222222222', targetCardIndex: 0,
    })
    expect(r.ok).toBe(true)
  })

  it('rejeita targetPlayerId que nao e uuid nem id de bot', () => {
    const r = parsePayload(GameEffectTargetSchema, {
      roomId: 'ABC123', playerId: HUMAN, targetPlayerId: 'lixo', targetCardIndex: 0,
    })
    expect(r.ok).toBe(false)
  })
})
