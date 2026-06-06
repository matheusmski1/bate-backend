import type { Server as SocketServer } from 'socket.io'
import type { GameState } from '@/types/shared'
import { redactStateForPlayer } from '../game/redact'
import { gameEvents } from '../events'
import { log } from '../logger'

export function broadcastRoom(io: SocketServer, state: GameState) {
  let emitted = 0
  for (const player of state.players) {
    if (!player.socketId) continue
    const redacted = redactStateForPlayer(state, player.id)
    io.to(player.socketId).emit('room:state', { state: redacted })
    emitted++
  }
  for (const spectator of state.spectators ?? []) {
    if (!spectator.socketId) continue
    const redacted = redactStateForPlayer(state, spectator.id, true)
    io.to(spectator.socketId).emit('room:state', { state: redacted })
    emitted++
  }
  log.debug('broadcast', 'sent', { room: state.roomId, phase: state.phase, emitted })
  gameEvents.emitBroadcast({
    roomId: state.roomId,
    phase: state.phase,
    recipients: emitted,
    roundNumber: state.roundNumber,
    roundStartedAt: state.roundStartedAt,
  })
}
