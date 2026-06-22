import type { Card, GameState, RoomSummary } from '@/types/shared'
import type { BotMemory } from '../game/bot/belief'

export type SocketBinding = { roomId: string; playerId: string }

export type DrawnCacheEntry = { roomId: string; card: Card }

export type CreateRoomInput = {
  name: string
  hostId: string
  hostName: string
  maxPlayers: 2 | 3 | 4
  turnTimeLimitSec?: number | null
  deck?: string
  arena?: string
  private?: boolean
}

export type JoinInput = { playerId: string; playerName: string; deck?: string; arena?: string }

export interface Storage {
  createRoom(input: CreateRoomInput): Promise<GameState>
  joinRoom(roomId: string, input: JoinInput): Promise<GameState>
  removePlayer(roomId: string, playerId: string): Promise<GameState | undefined>
  removeRoom(roomId: string): Promise<void>
  getRoom(roomId: string): Promise<GameState | undefined>
  setRoom(state: GameState): Promise<void>
  listRooms(): Promise<RoomSummary[]>
  getRoomsWithExpiredDeadline(now: number): Promise<GameState[]>

  bindSocket(socketId: string, roomId: string, playerId: string): Promise<void>
  releaseSocket(socketId: string): Promise<SocketBinding | undefined>

  setPlayerRoom(playerId: string, roomId: string): Promise<void>
  getPlayerRoom(playerId: string): Promise<string | undefined>
  clearPlayerRoom(playerId: string): Promise<void>

  setDrawnCard(playerId: string, entry: DrawnCacheEntry): Promise<void>
  getDrawnCard(playerId: string): Promise<DrawnCacheEntry | undefined>
  clearDrawnCard(playerId: string): Promise<void>

  setBotMemory(roomId: string, botId: string, mem: BotMemory): Promise<void>
  getBotMemory(roomId: string, botId: string): Promise<BotMemory | undefined>
  clearBotMemory(roomId: string): Promise<void>

  addPeekConfirmation(roomId: string, playerId: string): Promise<number>
  clearPeekConfirmations(roomId: string): Promise<void>

  withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T>

  clear(): Promise<void>
}
