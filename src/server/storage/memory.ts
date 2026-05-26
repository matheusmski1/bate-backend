import { randomUUID } from 'node:crypto'
import type { GameState, Player, RoomSummary } from '@/types/shared'
import { createEmptyRoom } from '../game/state'
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
  }
}

type PendingLock = { promise: Promise<void>; release: () => void }

export class MemoryStorage implements Storage {
  private rooms = new Map<string, GameState>()
  private socketIndex = new Map<string, SocketBinding>()
  private drawnCache = new Map<string, DrawnCacheEntry>()
  private peekConfirmed = new Map<string, Set<string>>()
  private locks = new Map<string, PendingLock>()

  async createRoom(input: CreateRoomInput): Promise<GameState> {
    const roomId = generateRoomId()
    const state = createEmptyRoom({ roomId, ...input })
    this.rooms.set(roomId, state)
    return state
  }

  async joinRoom(roomId: string, input: JoinInput): Promise<GameState> {
    const state = this.rooms.get(roomId)
    if (!state) throw new Error('ROOM_NOT_FOUND')
    const existing = state.players.find(p => p.id === input.playerId)
    if (existing) {
      const updated = { ...existing, connected: true, disconnectedAt: null }
      const players = state.players.map(p => (p.id === input.playerId ? updated : p))
      const next = { ...state, players }
      this.rooms.set(roomId, next)
      return next
    }
    if (state.players.length >= state.maxPlayers) throw new Error('ROOM_FULL')
    if (state.phase !== 'waiting' && state.phase !== 'round-end') throw new Error('GAME_IN_PROGRESS')
    const player: Player = {
      id: input.playerId,
      socketId: null,
      name: input.playerName,
      hand: [],
      score: 0,
      connected: true,
      disconnectedAt: null,
      revealedToSelf: [],
      skin: 'default',
      deck: input.deck ?? 'default',
      arena: input.arena ?? 'default',
    }
    const next = { ...state, players: [...state.players, player] }
    this.rooms.set(roomId, next)
    return next
  }

  async removePlayer(roomId: string, playerId: string): Promise<GameState | undefined> {
    const state = this.rooms.get(roomId)
    if (!state) return undefined
    const players = state.players.filter(p => p.id !== playerId)
    if (players.length === 0) {
      this.rooms.delete(roomId)
      return undefined
    }
    let hostId = state.hostId
    if (hostId === playerId) {
      const nextHost = players.find(p => p.connected) ?? players[0]
      if (nextHost) hostId = nextHost.id
    }
    const next = { ...state, players, hostId }
    this.rooms.set(roomId, next)
    return next
  }

  async removeRoom(roomId: string): Promise<void> {
    const existed = this.rooms.has(roomId)
    this.rooms.delete(roomId)
    const stack = new Error().stack?.split('\n').slice(2, 6).map(s => s.trim()).join(' <- ')
    log.warn('storage', 'removeRoom', { roomId, existed, calledBy: stack })
  }

  async getRoom(roomId: string): Promise<GameState | undefined> {
    const r = this.rooms.get(roomId)
    if (!r) {
      log.warn('storage', 'getRoom miss', { roomId, existingRooms: Array.from(this.rooms.keys()) })
    }
    return r
  }

  async setRoom(state: GameState): Promise<void> {
    this.rooms.set(state.roomId, state)
  }

  async listRooms(): Promise<RoomSummary[]> {
    return Array.from(this.rooms.values()).map(summarize)
  }

  async bindSocket(socketId: string, roomId: string, playerId: string): Promise<void> {
    this.socketIndex.set(socketId, { roomId, playerId })
  }

  async releaseSocket(socketId: string): Promise<SocketBinding | undefined> {
    const entry = this.socketIndex.get(socketId)
    if (entry) this.socketIndex.delete(socketId)
    return entry
  }

  async setDrawnCard(playerId: string, entry: DrawnCacheEntry): Promise<void> {
    this.drawnCache.set(playerId, entry)
  }

  async getDrawnCard(playerId: string): Promise<DrawnCacheEntry | undefined> {
    return this.drawnCache.get(playerId)
  }

  async clearDrawnCard(playerId: string): Promise<void> {
    this.drawnCache.delete(playerId)
  }

  async addPeekConfirmation(roomId: string, playerId: string): Promise<number> {
    let set = this.peekConfirmed.get(roomId)
    if (!set) {
      set = new Set()
      this.peekConfirmed.set(roomId, set)
    }
    set.add(playerId)
    return set.size
  }

  async clearPeekConfirmations(roomId: string): Promise<void> {
    this.peekConfirmed.delete(roomId)
  }

  async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(roomId)
    if (existing) await existing.promise
    let release!: () => void
    const promise = new Promise<void>(resolve => { release = resolve })
    this.locks.set(roomId, { promise, release })
    try {
      return await fn()
    } finally {
      this.locks.delete(roomId)
      release()
    }
  }

  async clear(): Promise<void> {
    this.rooms.clear()
    this.socketIndex.clear()
    this.drawnCache.clear()
    this.peekConfirmed.clear()
    this.locks.clear()
  }
}
