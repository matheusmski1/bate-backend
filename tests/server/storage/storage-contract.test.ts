import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import type { GameState } from '@/types/shared'
import type { Storage } from '@/server/storage/types'
import { MemoryStorage } from '@/server/storage/memory'
import { RedisStorage } from '@/server/storage/redis'

const createInput = (maxPlayers: 2 | 3 | 4 = 4) => ({
  name: 'Mesa',
  hostId: 'host-1',
  hostName: 'Ana',
  maxPlayers,
})

function playingWithDeadline(state: GameState, deadlineAt: number | null, paused = false): GameState {
  return { ...state, phase: 'playing', turnDeadlineAt: deadlineAt, paused }
}

function runStorageContract(label: string, makeStorage: () => Storage, teardown?: (s: Storage) => Promise<void>) {
  describe(`Contrato de Storage: ${label}`, () => {
    let storage: Storage

    beforeAll(() => {
      storage = makeStorage()
    })
    beforeEach(() => storage.clear())
    afterAll(async () => {
      await storage.clear()
      if (teardown) await teardown(storage)
    })

    it('cria e recupera uma sala', async () => {
      const created = await storage.createRoom(createInput())
      expect(created.phase).toBe('waiting')
      expect(created.players[0]?.id).toBe('host-1')

      const fetched = await storage.getRoom(created.roomId)
      expect(fetched?.roomId).toBe(created.roomId)
    })

    it('retorna undefined para sala inexistente', async () => {
      expect(await storage.getRoom('NAOEXISTE')).toBeUndefined()
    })

    it('persiste alteracoes via setRoom', async () => {
      const created = await storage.createRoom(createInput())
      await storage.setRoom({ ...created, phase: 'playing' })
      const fetched = await storage.getRoom(created.roomId)
      expect(fetched?.phase).toBe('playing')
    })

    it('adiciona jogador e barra quando lota', async () => {
      const created = await storage.createRoom(createInput(2))
      const joined = await storage.joinRoom(created.roomId, { playerId: 'p2', playerName: 'Beto' })
      expect(joined.players).toHaveLength(2)
      await expect(
        storage.joinRoom(created.roomId, { playerId: 'p3', playerName: 'Caio' }),
      ).rejects.toThrow('ROOM_FULL')
    })

    it('remove sala', async () => {
      const created = await storage.createRoom(createInput())
      await storage.removeRoom(created.roomId)
      expect(await storage.getRoom(created.roomId)).toBeUndefined()
    })

    it('lista salas com resumo', async () => {
      const a = await storage.createRoom(createInput())
      await storage.createRoom(createInput())
      const rooms = await storage.listRooms()
      expect(rooms).toHaveLength(2)
      const summary = rooms.find(r => r.roomId === a.roomId)
      expect(summary?.playerCount).toBe(1)
    })

    it('nao lista sala privada mas a recupera por id', async () => {
      const aberta = await storage.createRoom(createInput())
      const secreta = await storage.createRoom({ ...createInput(), private: true })

      const listadas = (await storage.listRooms()).map(r => r.roomId)
      expect(listadas).toContain(aberta.roomId)
      expect(listadas).not.toContain(secreta.roomId)

      const recuperada = await storage.getRoom(secreta.roomId)
      expect(recuperada?.roomId).toBe(secreta.roomId)
      expect(recuperada?.private).toBe(true)
    })

    it('getRoomsWithExpiredDeadline respeita deadline, fase e pause', async () => {
      const past = await storage.createRoom(createInput())
      await storage.setRoom(playingWithDeadline(past, Date.now() - 1000))

      const future = await storage.createRoom(createInput())
      await storage.setRoom(playingWithDeadline(future, Date.now() + 60_000))

      const paused = await storage.createRoom(createInput())
      await storage.setRoom(playingWithDeadline(paused, Date.now() - 1000, true))

      const waiting = await storage.createRoom(createInput())
      await storage.setRoom({ ...waiting, turnDeadlineAt: Date.now() - 1000 })

      const due = await storage.getRoomsWithExpiredDeadline(Date.now())
      const ids = due.map(r => r.roomId)
      expect(ids).toContain(past.roomId)
      expect(ids).not.toContain(future.roomId)
      expect(ids).not.toContain(paused.roomId)
      expect(ids).not.toContain(waiting.roomId)
    })

    it('faz roundtrip de socket binding', async () => {
      await storage.bindSocket('sock-1', 'ROOM1', 'p1')
      const released = await storage.releaseSocket('sock-1')
      expect(released).toEqual({ roomId: 'ROOM1', playerId: 'p1' })
      expect(await storage.releaseSocket('sock-1')).toBeUndefined()
    })

    it('faz roundtrip do indice player->sala', async () => {
      expect(await storage.getPlayerRoom('p1')).toBeUndefined()
      await storage.setPlayerRoom('p1', 'ROOM1')
      expect(await storage.getPlayerRoom('p1')).toBe('ROOM1')
      await storage.clearPlayerRoom('p1')
      expect(await storage.getPlayerRoom('p1')).toBeUndefined()
    })

    it('faz roundtrip da carta sacada', async () => {
      const entry = { roomId: 'ROOM1', card: { id: 'c1', rank: 'A' as const, suit: 'hearts' as const } }
      await storage.setDrawnCard('p1', entry)
      expect(await storage.getDrawnCard('p1')).toEqual(entry)
      await storage.clearDrawnCard('p1')
      expect(await storage.getDrawnCard('p1')).toBeUndefined()
    })

    it('conta e limpa confirmacoes de peek', async () => {
      expect(await storage.addPeekConfirmation('ROOM1', 'p1')).toBe(1)
      expect(await storage.addPeekConfirmation('ROOM1', 'p2')).toBe(2)
      expect(await storage.addPeekConfirmation('ROOM1', 'p1')).toBe(2)
      await storage.clearPeekConfirmations('ROOM1')
      expect(await storage.addPeekConfirmation('ROOM1', 'p3')).toBe(1)
    })

    it('withRoomLock serializa secoes criticas da mesma sala', async () => {
      const order: string[] = []
      const critical = async (tag: string) => {
        await storage.withRoomLock('ROOM1', async () => {
          order.push(`${tag}-start`)
          await new Promise(r => setTimeout(r, 30))
          order.push(`${tag}-end`)
        })
      }
      await Promise.all([critical('a'), critical('b')])

      const aEnd = order.indexOf('a-end')
      const bStart = order.indexOf('b-start')
      const bEnd = order.indexOf('b-end')
      const aStart = order.indexOf('a-start')
      const serialized = aEnd < bStart || bEnd < aStart
      expect(serialized).toBe(true)
    })
  })
}

runStorageContract('MemoryStorage', () => new MemoryStorage())

const redisUrl = process.env.TEST_REDIS_URL
const redisSuite = redisUrl ? runStorageContract : () => {}
redisSuite(
  'RedisStorage',
  () => new RedisStorage(redisUrl as string),
  s => (s as RedisStorage).disconnect(),
)
