import type { Server as SocketServer } from 'socket.io'
import type { GamePhase, GameState } from '@/types/shared'
import { lobby } from '../lobby'
import { broadcastRoom } from './broadcast'
import { planEndReveal } from '../game/state'
import { log } from '../logger'

const DEFAULT_REVEAL_MS = Number(process.env.ROUND_END_REVEAL_MS ?? 2500)

export function scheduleEndReveal(
  io: SocketServer,
  roomId: string,
  expectedPhase: GamePhase,
  expectedRoundNumber: number,
  delayMs: number = DEFAULT_REVEAL_MS,
): void {
  setTimeout(() => {
    void (async () => {
      const current = await lobby.getRoom(roomId)
      if (!current) return
      if (current.phase !== expectedPhase || current.roundNumber !== expectedRoundNumber) return
      broadcastRoom(io, current)
    })().catch(err => log.error('end-reveal', 'scheduleEndReveal failed', { roomId, error: err instanceof Error ? err.message : 'UNKNOWN' }))
  }, delayMs)
}

export function broadcastEndAware(
  io: SocketServer,
  prevPhase: GamePhase,
  next: GameState,
  delayMs: number = DEFAULT_REVEAL_MS,
): void {
  const plan = planEndReveal(prevPhase, next)
  if (!plan.reveal) {
    broadcastRoom(io, next)
    return
  }
  broadcastRoom(io, plan.snapshot)
  scheduleEndReveal(io, next.roomId, next.phase, next.roundNumber, delayMs)
}
