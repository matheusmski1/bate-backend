import { describe, it, expect, beforeEach } from 'vitest'
import { setStorage } from '@/server/storage'
import { MemoryStorage } from '@/server/storage/memory'
import { lobby } from '@/server/lobby'
import { registerLobbyHandlers } from '@/server/handlers/lobby-handlers'

function fakeSocket(playerId: string) {
  const handlers = new Map<string, (raw: unknown, ack: (r: unknown) => void) => void>()
  return {
    socket: { data: { playerId }, on: (e: string, fn: never) => handlers.set(e, fn as never), join: () => {}, leave: () => {}, id: 's1' } as never,
    emit: (e: string, raw: unknown) => new Promise<any>(res => handlers.get(e)!(raw, res)),
  }
}
const io = { to: () => ({ emit: () => {} }), sockets: { sockets: { has: () => true } } } as never

beforeEach(() => { setStorage(new MemoryStorage()) })

describe('room:create-practice', () => {
  it('cria sala privada com N bots e ja inicia a rodada', async () => {
    const { socket, emit } = fakeSocket('11111111-1111-4111-8111-111111111111')
    registerLobbyHandlers(io, socket)
    const res = await emit('room:create-practice', { hostId: '00000000-0000-0000-0000-000000000000', hostName: 'Eu', bots: 2, level: 'hard' })
    expect(res.roomId).toBeTruthy()
    const room = await lobby.getRoom(res.roomId)
    expect(room!.players.filter(p => p.isBot)).toHaveLength(2)
    expect(room!.private).toBe(true)
    expect(['initial-peek', 'playing']).toContain(room!.phase)
    expect(room!.players.find(p => !p.isBot)?.socketId).toBe('s1')
  })

  it('remove a sala e a memoria do bot quando o humano sai', async () => {
    const HOST = '22222222-2222-4222-8222-222222222222'
    const { socket, emit } = fakeSocket(HOST)
    registerLobbyHandlers(io, socket)
    const { roomId } = await emit('room:create-practice', { hostId: '00000000-0000-0000-0000-000000000000', hostName: 'Eu', bots: 2, level: 'easy' })
    await emit('room:leave', { roomId, playerId: '00000000-0000-0000-0000-000000000000' })
    expect(await lobby.getRoom(roomId)).toBeUndefined()
    expect(await lobby.getBotMemory(roomId, `bot:${roomId}:0`)).toBeUndefined()
  })
})
