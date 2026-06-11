import type { Server as SocketServer } from 'socket.io'
import type { GameState } from '@/types/shared'
import { lobby } from '../lobby'
import { broadcastRoom } from './broadcast'
import { tallyRound, FINAL_SNAP_WINDOW_MS } from '../game/engine'
import { log } from '../logger'

export const FINAL_SNAP_EXTEND_MS = Number(process.env.FINAL_SNAP_EXTEND_MS ?? 2000)

const finalizeTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleRoundFinalize(
  io: SocketServer,
  roomId: string,
  expectedRoundNumber: number,
  delayMs: number = FINAL_SNAP_WINDOW_MS,
): void {
  const existing = finalizeTimers.get(roomId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    finalizeTimers.delete(roomId)
    void (async () => {
      await lobby.withRoomLock(roomId, async () => {
        const current = await lobby.getRoom(roomId)
        if (!current) return
        if (current.phase !== 'final-snap' || current.roundNumber !== expectedRoundNumber) return
        const ended = tallyRound(current)
        await lobby.setRoom(ended)
        broadcastRoom(io, ended)
      })
    })().catch(err => log.error('final-snap', 'finalize failed', { roomId, error: err instanceof Error ? err.message : 'UNKNOWN' }))
  }, delayMs)
  finalizeTimers.set(roomId, timer)
}

export function broadcastSnapExtend(io: SocketServer, next: GameState): void {
  broadcastRoom(io, next)
  scheduleRoundFinalize(io, next.roomId, next.roundNumber, FINAL_SNAP_EXTEND_MS)
}

export function broadcastAfterAction(
  io: SocketServer,
  next: GameState,
  delayMs: number = FINAL_SNAP_WINDOW_MS,
): void {
  broadcastRoom(io, next)
  if (next.phase === 'final-snap') {
    scheduleRoundFinalize(io, next.roomId, next.roundNumber, delayMs)
  }
}
