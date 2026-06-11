import { describe, it, expect } from 'vitest'
import { generateUniqueRoomId } from '@/server/storage/room-id'

describe('generateUniqueRoomId', () => {
  it('retorna o primeiro id livre no formato esperado', async () => {
    const id = await generateUniqueRoomId(() => false)
    expect(id).toMatch(/^[0-9A-F]{6}$/)
  })

  it('tenta de novo enquanto o id ja existe', async () => {
    let chamadas = 0
    const id = await generateUniqueRoomId(() => {
      chamadas++
      return chamadas <= 2
    })
    expect(chamadas).toBe(3)
    expect(id).toMatch(/^[0-9A-F]{6}$/)
  })

  it('desiste depois de maxAttempts', async () => {
    await expect(generateUniqueRoomId(() => true, 3)).rejects.toThrow('ROOM_ID_GENERATION_FAILED')
  })
})
