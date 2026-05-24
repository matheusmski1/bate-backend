import type { Server as SocketServer, Socket } from 'socket.io'
import { lobby } from '../lobby'
import { broadcastRoom } from './broadcast'
import { pauseTimer, resumeTimer } from '../game/engine'

export function registerLobbyHandlers(io: SocketServer, socket: Socket) {
  socket.on('lobby:subscribe', async () => {
    socket.join('lobby')
    socket.emit('lobby:update', { rooms: await lobby.listRooms() })
  })

  socket.on('lobby:unsubscribe', () => {
    socket.leave('lobby')
  })

  socket.on(
    'room:create',
    async (
      payload: { name: string; hostId: string; hostName: string; maxPlayers: 2 | 3 | 4; turnTimeLimitSec?: number | null },
      ack: (res: { roomId: string } | { error: string }) => void,
    ) => {
      try {
        const state = await lobby.createRoom(payload)
        ack({ roomId: state.roomId })
        io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
      } catch (err) {
        ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
      }
    },
  )

  socket.on(
    'room:pause',
    async (
      payload: { roomId: string; playerId: string; paused: boolean },
      ack?: (res: { ok: true } | { error: string }) => void,
    ) => {
      try {
        const next = await lobby.withRoomLock(payload.roomId, async () => {
          const room = await lobby.getRoom(payload.roomId)
          if (!room) throw new Error('ROOM_NOT_FOUND')
          if (room.hostId !== payload.playerId) throw new Error('NOT_HOST')
          const updated = payload.paused ? pauseTimer(room) : resumeTimer(room)
          await lobby.setRoom(updated)
          return updated
        })
        ack?.({ ok: true })
        broadcastRoom(io, next)
      } catch (err) {
        ack?.({ error: err instanceof Error ? err.message : 'UNKNOWN' })
      }
    },
  )

  socket.on(
    'room:join',
    async (
      payload: { roomId: string; playerId: string; playerName: string },
      ack: (res: { ok: true } | { error: string }) => void,
    ) => {
      try {
        const state = await lobby.withRoomLock(payload.roomId, async () => {
          const next = await lobby.joinRoom(payload.roomId, payload)
          const player = next.players.find(p => p.id === payload.playerId)
          if (player) player.socketId = socket.id
          await lobby.setRoom(next)
          return next
        })
        socket.join(payload.roomId)
        await lobby.bindSocket(socket.id, payload.roomId, payload.playerId)
        console.log(`[room:join] socket=${socket.id} player=${payload.playerId} room=${payload.roomId} totalPlayers=${state.players.length}`)
        ack({ ok: true })
        broadcastRoom(io, state)
        io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
      } catch (err) {
        console.log(`[room:join] ERROR ${err instanceof Error ? err.message : 'UNKNOWN'} for player=${payload.playerId} room=${payload.roomId}`)
        ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
      }
    },
  )
}
