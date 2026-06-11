import { getStorage } from './storage'
import type { CreateRoomInput, JoinInput, SocketBinding, DrawnCacheEntry } from './storage'
import type { GameState, RoomSummary } from '@/types/shared'

export const lobby = {
  createRoom(input: CreateRoomInput): Promise<GameState> {
    return getStorage().createRoom(input)
  },

  joinRoom(roomId: string, input: JoinInput): Promise<GameState> {
    return getStorage().joinRoom(roomId, input)
  },

  removePlayer(roomId: string, playerId: string): Promise<GameState | undefined> {
    return getStorage().removePlayer(roomId, playerId)
  },

  removeRoom(roomId: string): Promise<void> {
    return getStorage().removeRoom(roomId)
  },

  getRoom(roomId: string): Promise<GameState | undefined> {
    return getStorage().getRoom(roomId)
  },

  setRoom(state: GameState): Promise<void> {
    return getStorage().setRoom(state)
  },

  listRooms(): Promise<RoomSummary[]> {
    return getStorage().listRooms()
  },

  getRoomsWithExpiredDeadline(now: number): Promise<GameState[]> {
    return getStorage().getRoomsWithExpiredDeadline(now)
  },

  bindSocket(socketId: string, roomId: string, playerId: string): Promise<void> {
    return getStorage().bindSocket(socketId, roomId, playerId)
  },

  releaseSocket(socketId: string): Promise<SocketBinding | undefined> {
    return getStorage().releaseSocket(socketId)
  },

  setPlayerRoom(playerId: string, roomId: string): Promise<void> {
    return getStorage().setPlayerRoom(playerId, roomId)
  },

  getPlayerRoom(playerId: string): Promise<string | undefined> {
    return getStorage().getPlayerRoom(playerId)
  },

  clearPlayerRoom(playerId: string): Promise<void> {
    return getStorage().clearPlayerRoom(playerId)
  },

  setDrawnCard(playerId: string, entry: DrawnCacheEntry): Promise<void> {
    return getStorage().setDrawnCard(playerId, entry)
  },

  getDrawnCard(playerId: string): Promise<DrawnCacheEntry | undefined> {
    return getStorage().getDrawnCard(playerId)
  },

  clearDrawnCard(playerId: string): Promise<void> {
    return getStorage().clearDrawnCard(playerId)
  },

  addPeekConfirmation(roomId: string, playerId: string): Promise<number> {
    return getStorage().addPeekConfirmation(roomId, playerId)
  },

  clearPeekConfirmations(roomId: string): Promise<void> {
    return getStorage().clearPeekConfirmations(roomId)
  },

  withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    return getStorage().withRoomLock(roomId, fn)
  },

  clear(): Promise<void> {
    return getStorage().clear()
  },
}
