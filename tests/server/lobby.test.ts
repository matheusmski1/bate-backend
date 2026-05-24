import { describe, it, expect, beforeEach } from 'vitest'
import { lobby } from '@/server/lobby'

describe('lobby registry', () => {
  beforeEach(async () => {
    await lobby.clear()
  })

  it('cria sala e retorna roomId', async () => {
    const room = await lobby.createRoom({ name: 'Mesa 1', hostId: 'p1', hostName: 'Matheus', maxPlayers: 4 })
    expect(room.roomId).toBeTruthy()
    expect(room.name).toBe('Mesa 1')
    expect(room.players[0]?.id).toBe('p1')
  })

  it('lista resumo de salas (sem state interno)', async () => {
    await lobby.createRoom({ name: 'A', hostId: 'p1', hostName: 'h', maxPlayers: 2 })
    await lobby.createRoom({ name: 'B', hostId: 'p2', hostName: 'h', maxPlayers: 4 })
    const summaries = await lobby.listRooms()
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toHaveProperty('roomId')
    expect(summaries[0]).toHaveProperty('playerCount')
  })

  it('adiciona player a sala existente', async () => {
    const room = await lobby.createRoom({ name: 'A', hostId: 'p1', hostName: 'h', maxPlayers: 4 })
    const updated = await lobby.joinRoom(room.roomId, { playerId: 'p2', playerName: 'João' })
    expect(updated.players).toHaveLength(2)
  })

  it('lança ao entrar em sala cheia', async () => {
    const room = await lobby.createRoom({ name: 'A', hostId: 'p1', hostName: 'h', maxPlayers: 2 })
    await lobby.joinRoom(room.roomId, { playerId: 'p2', playerName: 'b' })
    await expect(lobby.joinRoom(room.roomId, { playerId: 'p3', playerName: 'c' })).rejects.toThrow('ROOM_FULL')
  })

  it('reconexão (mesmo playerId) não duplica', async () => {
    const room = await lobby.createRoom({ name: 'A', hostId: 'p1', hostName: 'h', maxPlayers: 4 })
    const after = await lobby.joinRoom(room.roomId, { playerId: 'p1', playerName: 'h' })
    expect(after.players).toHaveLength(1)
  })

  it('remove sala se ficar vazia', async () => {
    const room = await lobby.createRoom({ name: 'A', hostId: 'p1', hostName: 'h', maxPlayers: 2 })
    await lobby.removePlayer(room.roomId, 'p1')
    expect(await lobby.getRoom(room.roomId)).toBeUndefined()
  })

  it('withRoomLock serializa mutações concorrentes', async () => {
    const room = await lobby.createRoom({ name: 'A', hostId: 'p1', hostName: 'h', maxPlayers: 2 })
    const order: number[] = []
    await Promise.all([
      lobby.withRoomLock(room.roomId, async () => {
        await new Promise(r => setTimeout(r, 30))
        order.push(1)
      }),
      lobby.withRoomLock(room.roomId, async () => {
        order.push(2)
      }),
    ])
    expect(order).toEqual([1, 2])
  })
})
