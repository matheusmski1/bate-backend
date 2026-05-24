import { randomUUID } from 'node:crypto'
import { createClient, type RedisClientType } from 'redis'
import type { GameState, Player, RoomSummary } from '@/types/shared'
import { createEmptyRoom } from '../game/state'
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
  }
}

const ROOMS_KEY = 'bate:rooms'
const SOCKET_INDEX_KEY = 'bate:socket-index'
const DRAWN_KEY = 'bate:drawn'
const PEEK_KEY = (roomId: string) => `bate:peek:${roomId}`
const LOCK_KEY = (roomId: string) => `bate:lock:${roomId}`
const LOCK_TTL_MS = 5000

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class RedisStorage implements Storage {
  private client: RedisClientType
  private ready: Promise<void>

  constructor(url: string) {
    this.client = createClient({ url })
    this.client.on('error', err => console.error('[redis] error', err))
    this.ready = this.client.connect().then(() => {
      console.log('[redis] connected')
    })
  }

  private async withClient<T>(fn: (c: RedisClientType) => Promise<T>): Promise<T> {
    await this.ready
    return fn(this.client)
  }

  async createRoom(input: CreateRoomInput): Promise<GameState> {
    const roomId = generateRoomId()
    const state = createEmptyRoom({ roomId, ...input })
    await this.setRoom(state)
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
      await this.setRoom(next)
      return next
    }
    if (state.players.length >= state.maxPlayers) throw new Error('ROOM_FULL')
    if (state.phase !== 'waiting') throw new Error('GAME_IN_PROGRESS')
    const player: Player = {
      id: input.playerId,
      socketId: null,
      name: input.playerName,
      hand: [],
      score: 0,
      connected: true,
      disconnectedAt: null,
      revealedToSelf: [],
    }
    const next = { ...state, players: [...state.players, player] }
    await this.setRoom(next)
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
    const next = { ...state, players }
    await this.setRoom(next)
    return next
  }

  async removeRoom(roomId: string): Promise<void> {
    await this.withClient(async c => {
      await c.hDel(ROOMS_KEY, roomId)
      await c.del(PEEK_KEY(roomId))
    })
  }

  async getRoom(roomId: string): Promise<GameState | undefined> {
    return this.withClient(async c => {
      const raw = await c.hGet(ROOMS_KEY, roomId)
      if (!raw) return undefined
      return JSON.parse(raw) as GameState
    })
  }

  async setRoom(state: GameState): Promise<void> {
    await this.withClient(c => c.hSet(ROOMS_KEY, state.roomId, JSON.stringify(state)))
  }

  async listRooms(): Promise<RoomSummary[]> {
    return this.withClient(async c => {
      const all = await c.hGetAll(ROOMS_KEY)
      return Object.values(all).map(s => summarize(JSON.parse(s) as GameState))
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
      await c.sAdd(PEEK_KEY(roomId), playerId)
      return c.sCard(PEEK_KEY(roomId))
    })
  }

  async clearPeekConfirmations(roomId: string): Promise<void> {
    await this.withClient(c => c.del(PEEK_KEY(roomId)))
  }

  async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID()
    const key = LOCK_KEY(roomId)
    let acquired = false
    for (let i = 0; i < 100; i++) {
      acquired = (await this.withClient(c => c.set(key, token, { NX: true, PX: LOCK_TTL_MS }))) === 'OK'
      if (acquired) break
      await sleep(20)
    }
    if (!acquired) throw new Error('LOCK_TIMEOUT')
    try {
      return await fn()
    } finally {
      await this.withClient(async c => {
        const current = await c.get(key)
        if (current === token) await c.del(key)
      })
    }
  }

  async clear(): Promise<void> {
    await this.withClient(async c => {
      await c.del(ROOMS_KEY)
      await c.del(SOCKET_INDEX_KEY)
      await c.del(DRAWN_KEY)
      const keys = await c.keys('bate:peek:*')
      if (keys.length) await c.del(keys)
      const locks = await c.keys('bate:lock:*')
      if (locks.length) await c.del(locks)
    })
  }
}
