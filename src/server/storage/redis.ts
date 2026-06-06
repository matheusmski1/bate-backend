import { randomUUID } from 'node:crypto'
import { createClient, type RedisClientType } from 'redis'
import type { GameState, Player, RoomSummary } from '@/types/shared'
import { createEmptyRoom, trimLog } from '../game/state'
import { log } from '../logger'
import type { Storage, CreateRoomInput, JoinInput, SocketBinding, DrawnCacheEntry } from './types'

function generateRoomId(): string {
  return randomUUID().slice(0, 6).toUpperCase()
}

function summarize(state: GameState): RoomSummary {
  return {
    roomId: state.roomId,
    name: state.name,
    playerCount: state.players.length,
    maxPlayers: state.maxPlayers,
    phase: state.phase,
    spectatorCount: state.spectators?.length ?? 0,
    pendingJoinCount: state.pendingJoins?.length ?? 0,
  }
}

const ROOM_KEY = (roomId: string) => `bate:room:${roomId}`
const SUMMARIES_KEY = 'bate:summaries'
const DEADLINES_KEY = 'bate:deadlines'
const SOCKET_INDEX_KEY = 'bate:socket-index'
const PLAYER_ROOM_KEY = 'bate:player-room'
const DRAWN_KEY = 'bate:drawn'
const PEEK_KEY = (roomId: string) => `bate:peek:${roomId}`
const LOCK_KEY = (roomId: string) => `bate:lock:${roomId}`

const ROOM_TTL_MS = 30 * 60 * 1000
const LOCK_TTL_MS = 5000
const LOCK_MAX_RETRIES = 50
const LOCK_RETRY_MS = 10
const POOL_SIZE = Number(process.env.REDIS_POOL_SIZE ?? 8)
const STORAGE_MAX_ATTEMPTS = 3
const STORAGE_RETRY_BASE_MS = 50
const STORED_LOG_LIMIT = 60

const UNLOCK_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function isActiveDeadline(state: GameState): boolean {
  return (state.phase === 'playing' || state.phase === 'bate-called') && state.turnDeadlineAt !== null && !state.paused
}

export class RedisStorage implements Storage {
  private pool: RedisClientType[]
  private ready: Promise<unknown>
  private cursor = 0

  constructor(url: string) {
    const size = Math.max(1, POOL_SIZE)
    this.pool = Array.from({ length: size }, () => createClient({ url }))
    this.pool.forEach(c => c.on('error', err => console.error('[redis] error', err)))
    this.ready = Promise.all(this.pool.map(c => c.connect())).then(() => {
      console.log(`[redis] connected (pool=${size})`)
    })
  }

  private pick(): RedisClientType {
    const client = this.pool[this.cursor]!
    this.cursor = (this.cursor + 1) % this.pool.length
    return client
  }

  private async withClient<T>(fn: (c: RedisClientType) => Promise<T>): Promise<T> {
    await this.ready
    let lastErr: unknown
    for (let attempt = 0; attempt < STORAGE_MAX_ATTEMPTS; attempt++) {
      try {
        return await fn(this.pick())
      } catch (err) {
        lastErr = err
        if (attempt < STORAGE_MAX_ATTEMPTS - 1) {
          log.warn('redis', 'op transiente falhou — retry', { attempt: attempt + 1 })
          await sleep(STORAGE_RETRY_BASE_MS * (attempt + 1))
        }
      }
    }
    throw lastErr
  }

  async disconnect(): Promise<void> {
    await this.ready
    await Promise.all(this.pool.map(c => c.quit().catch(() => undefined)))
  }

  private async persist(state: GameState): Promise<void> {
    await this.withClient(async c => {
      const multi = c.multi()
      const stored = { ...state, log: trimLog(state.log, STORED_LOG_LIMIT) }
      multi.set(ROOM_KEY(state.roomId), JSON.stringify(stored), { PX: ROOM_TTL_MS })
      multi.hSet(SUMMARIES_KEY, state.roomId, JSON.stringify(summarize(state)))
      if (isActiveDeadline(state)) {
        multi.zAdd(DEADLINES_KEY, { score: state.turnDeadlineAt!, value: state.roomId })
      } else {
        multi.zRem(DEADLINES_KEY, state.roomId)
      }
      await multi.exec()
    })
  }

  async createRoom(input: CreateRoomInput): Promise<GameState> {
    const roomId = generateRoomId()
    const state = createEmptyRoom({ roomId, ...input })
    await this.persist(state)
    return state
  }

  async joinRoom(roomId: string, input: JoinInput): Promise<GameState> {
    const state = await this.getRoom(roomId)
    if (!state) throw new Error('ROOM_NOT_FOUND')
    const existing = state.players.find(p => p.id === input.playerId)
    if (existing) {
      const updated = { ...existing, connected: true, disconnectedAt: null }
      const players = state.players.map(p => (p.id === input.playerId ? updated : p))
      const next = { ...state, players }
      await this.persist(next)
      return next
    }
    const existingPending = state.pendingJoins.find(p => p.id === input.playerId)
    if (existingPending) {
      return state
    }
    const player: Player = {
      id: input.playerId,
      socketId: null,
      name: input.playerName,
      hand: [],
      score: 0,
      connected: true,
      disconnectedAt: null,
      revealedToSelf: [],
      deck: input.deck ?? 'default',
      arena: input.arena ?? 'default',
    }
    const gameInProgress = state.phase !== 'waiting' && state.phase !== 'round-end'
    if (gameInProgress) {
      const next = { ...state, pendingJoins: [...state.pendingJoins, player] }
      await this.persist(next)
      return next
    }
    if (state.players.length >= state.maxPlayers) throw new Error('ROOM_FULL')
    const next = { ...state, players: [...state.players, player] }
    await this.persist(next)
    return next
  }

  async removePlayer(roomId: string, playerId: string): Promise<GameState | undefined> {
    const state = await this.getRoom(roomId)
    if (!state) return undefined
    const players = state.players.filter(p => p.id !== playerId)
    if (players.length === 0) {
      await this.removeRoom(roomId)
      return undefined
    }
    let hostId = state.hostId
    if (hostId === playerId) {
      const nextHost = players.find(p => p.connected) ?? players[0]
      if (nextHost) hostId = nextHost.id
    }
    const next = { ...state, players, hostId }
    await this.persist(next)
    return next
  }

  async removeRoom(roomId: string): Promise<void> {
    await this.withClient(async c => {
      const multi = c.multi()
      multi.del(ROOM_KEY(roomId))
      multi.hDel(SUMMARIES_KEY, roomId)
      multi.zRem(DEADLINES_KEY, roomId)
      multi.del(PEEK_KEY(roomId))
      await multi.exec()
    })
  }

  async getRoom(roomId: string): Promise<GameState | undefined> {
    return this.withClient(async c => {
      const raw = await c.get(ROOM_KEY(roomId))
      return raw ? (JSON.parse(raw) as GameState) : undefined
    })
  }

  async setRoom(state: GameState): Promise<void> {
    await this.persist(state)
  }

  async listRooms(): Promise<RoomSummary[]> {
    return this.withClient(async c => {
      const all = await c.hGetAll(SUMMARIES_KEY)
      return Object.values(all).map(s => JSON.parse(s) as RoomSummary)
    })
  }

  async getRoomsWithExpiredDeadline(now: number): Promise<GameState[]> {
    return this.withClient(async c => {
      const ids = await c.zRangeByScore(DEADLINES_KEY, '-inf', now)
      if (ids.length === 0) return []
      const raws = await c.mGet(ids.map(ROOM_KEY))
      const rooms: GameState[] = []
      const stale: string[] = []
      raws.forEach((raw, i) => {
        if (raw) rooms.push(JSON.parse(raw) as GameState)
        else stale.push(ids[i]!)
      })
      if (stale.length) await c.zRem(DEADLINES_KEY, stale)
      return rooms
    })
  }

  async bindSocket(socketId: string, roomId: string, playerId: string): Promise<void> {
    await this.withClient(c => c.hSet(SOCKET_INDEX_KEY, socketId, JSON.stringify({ roomId, playerId })))
  }

  async releaseSocket(socketId: string): Promise<SocketBinding | undefined> {
    return this.withClient(async c => {
      const raw = await c.hGet(SOCKET_INDEX_KEY, socketId)
      if (!raw) return undefined
      await c.hDel(SOCKET_INDEX_KEY, socketId)
      return JSON.parse(raw) as SocketBinding
    })
  }

  async setPlayerRoom(playerId: string, roomId: string): Promise<void> {
    await this.withClient(c => c.hSet(PLAYER_ROOM_KEY, playerId, roomId))
  }

  async getPlayerRoom(playerId: string): Promise<string | undefined> {
    return this.withClient(async c => (await c.hGet(PLAYER_ROOM_KEY, playerId)) ?? undefined)
  }

  async clearPlayerRoom(playerId: string): Promise<void> {
    await this.withClient(c => c.hDel(PLAYER_ROOM_KEY, playerId))
  }

  async setDrawnCard(playerId: string, entry: DrawnCacheEntry): Promise<void> {
    await this.withClient(c => c.hSet(DRAWN_KEY, playerId, JSON.stringify(entry)))
  }

  async getDrawnCard(playerId: string): Promise<DrawnCacheEntry | undefined> {
    return this.withClient(async c => {
      const raw = await c.hGet(DRAWN_KEY, playerId)
      return raw ? (JSON.parse(raw) as DrawnCacheEntry) : undefined
    })
  }

  async clearDrawnCard(playerId: string): Promise<void> {
    await this.withClient(c => c.hDel(DRAWN_KEY, playerId))
  }

  async addPeekConfirmation(roomId: string, playerId: string): Promise<number> {
    return this.withClient(async c => {
      const multi = c.multi()
      multi.sAdd(PEEK_KEY(roomId), playerId)
      multi.expire(PEEK_KEY(roomId), Math.ceil(ROOM_TTL_MS / 1000))
      multi.sCard(PEEK_KEY(roomId))
      const res = await multi.exec()
      return Number(res[res.length - 1])
    })
  }

  async clearPeekConfirmations(roomId: string): Promise<void> {
    await this.withClient(c => c.del(PEEK_KEY(roomId)))
  }

  async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID()
    const key = LOCK_KEY(roomId)
    let acquired = false
    for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
      acquired = (await this.withClient(c => c.set(key, token, { NX: true, PX: LOCK_TTL_MS }))) === 'OK'
      if (acquired) break
      await sleep(LOCK_RETRY_MS)
    }
    if (!acquired) throw new Error('LOCK_TIMEOUT')
    try {
      return await fn()
    } finally {
      try {
        await this.withClient(c => c.eval(UNLOCK_SCRIPT, { keys: [key], arguments: [token] }))
      } catch {
        log.warn('redis', 'unlock falhou (lock expira via TTL)', { room: roomId })
      }
    }
  }

  async clear(): Promise<void> {
    await this.withClient(async c => {
      await c.del([SUMMARIES_KEY, SOCKET_INDEX_KEY, PLAYER_ROOM_KEY, DRAWN_KEY, DEADLINES_KEY])
      for (const pattern of ['bate:room:*', 'bate:peek:*', 'bate:lock:*']) {
        let cursor = '0'
        do {
          const res = await c.scan(cursor, { MATCH: pattern, COUNT: 200 })
          cursor = res.cursor
          if (res.keys.length) await c.del(res.keys)
        } while (cursor !== '0')
      }
    })
  }
}
