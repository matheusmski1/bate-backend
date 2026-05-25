import type { Card, GameState, RoomSummary } from '@/types/shared'

export type SocketBinding = { roomId: string; playerId: string }

export type DrawnCacheEntry = { roomId: string; card: Card }

export type CreateRoomInput = {
  name: string
  hostId: string
  hostName: string
  maxPlayers: 2 | 3 | 4
  turnTimeLimitSec?: number | null
  skin?: string
}

export type JoinInput = { playerId: string; playerName: string; skin?: string }

export interface Storage {
  createRoom(input: CreateRoomInput): Promise<GameState>
  joinRoom(roomId: string, input: JoinInput): Promise<GameState>
  removePlayer(roomId: string, playerId: string): Promise<GameState | undefined>
  removeRoom(roomId: string): Promise<void>
  getRoom(roomId: string): Promise<GameState | undefined>
  setRoom(state: GameState): Promise<void>
  listRooms(): Promise<RoomSummary[]>

  bindSocket(socketId: string, roomId: string, playerId: string): Promise<void>
  releaseSocket(socketId: string): Promise<SocketBinding | undefined>

  setDrawnCard(playerId: string, entry: DrawnCacheEntry): Promise<void>
  getDrawnCard(playerId: string): Promise<DrawnCacheEntry | undefined>
  clearDrawnCard(playerId: string): Promise<void>

  addPeekConfirmation(roomId: string, playerId: string): Promise<number>
  clearPeekConfirmations(roomId: string): Promise<void>

  withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T>

  clear(): Promise<void>
}
