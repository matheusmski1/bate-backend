import type { GameState, RoomSummary } from '@/types/shared'
import { shouldExpireIdleRoom } from './state'

export interface SweepDeps {
  listRooms: () => Promise<RoomSummary[]>
  getRoom: (roomId: string) => Promise<GameState | undefined>
  removeRoom: (roomId: string) => Promise<void>
  now: number
  idleLimitMs: number
  isConnected: (socketId: string | null) => boolean
  onIdleExpire?: (room: GameState) => void
}

export interface SweepResult {
  scanned: number
  expired: string[]
  orphaned: string[]
}

export async function sweepRooms(deps: SweepDeps): Promise<SweepResult> {
  const { listRooms, getRoom, removeRoom, now, idleLimitMs, isConnected, onIdleExpire } = deps
  const summaries = await listRooms()
  const expired: string[] = []
  const orphaned: string[] = []

  for (const summary of summaries) {
    const room = await getRoom(summary.roomId)
    if (!room) {
      await removeRoom(summary.roomId)
      orphaned.push(summary.roomId)
      continue
    }
    if (shouldExpireIdleRoom(room, now, idleLimitMs, isConnected)) {
      onIdleExpire?.(room)
      await removeRoom(summary.roomId)
      expired.push(summary.roomId)
    }
  }

  return { scanned: summaries.length, expired, orphaned }
}
