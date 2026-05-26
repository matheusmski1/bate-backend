import type { Server as SocketServer, Socket } from 'socket.io'
import { lobby } from '../lobby'
import { broadcastRoom } from './broadcast'
import { pauseTimer, resumeTimer, removePlayerMidGame } from '../game/engine'
import { AppDataSource } from '../db/data-source'

import { getEquippedDeck } from '../db/decks'
import { getEquippedArena } from '../db/arenas'



async function lookupDeck(playerId: string): Promise<string> {
  if (!AppDataSource.isInitialized) return 'default'
  try {
    return await getEquippedDeck(playerId)
  } catch {
    return 'default'
  }
}

async function lookupArena(playerId: string): Promise<string> {
  if (!AppDataSource.isInitialized) return 'default'
  try {
    return await getEquippedArena(playerId)
  } catch {
    return 'default'
  }
}
import {
  parseAndAuth,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomLeaveSchema,
  RoomEmoteSchema,
  RoomPauseSchema,
  RoomSpectateSchema,
} from './schemas'
import { redactStateForPlayer } from '../game/redact'

const EMOTE_COOLDOWN_MS = 2500
const lastEmoteAt = new Map<string, number>()

export function registerLobbyHandlers(io: SocketServer, socket: Socket) {
  socket.on('lobby:subscribe', async () => {
    socket.join('lobby')
    socket.emit('lobby:update', { rooms: await lobby.listRooms() })
  })

  socket.on('lobby:unsubscribe', () => {
    socket.leave('lobby')
  })

  socket.on('room:create', async (raw: unknown, ack: (res: { roomId?: string; error?: string }) => void) => {
    const payload = parseAndAuth(RoomCreateSchema, raw, ack, socket)
    if (!payload) return
    try {
      const [deck, arena] = await Promise.all([lookupDeck(payload.hostId), lookupArena(payload.hostId)])
      const state = await lobby.createRoom({ ...payload, deck, arena })
      ack({ roomId: state.roomId })
      io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('room:emote', async (raw: unknown, ack?: (res: { ok?: true; error?: string }) => void) => {
    const payload = parseAndAuth(RoomEmoteSchema, raw, ack, socket)
    if (!payload) return
    try {
      const now = Date.now()
      const last = lastEmoteAt.get(payload.playerId) ?? 0
      if (now - last < EMOTE_COOLDOWN_MS) throw new Error('EMOTE_COOLDOWN')
      const room = await lobby.getRoom(payload.roomId)
      if (!room) throw new Error('ROOM_NOT_FOUND')
      if (!room.players.some(p => p.id === payload.playerId)) throw new Error('PLAYER_NOT_IN_ROOM')
      lastEmoteAt.set(payload.playerId, now)
      for (const player of room.players) {
        if (player.socketId && io.sockets.sockets.has(player.socketId)) {
          io.to(player.socketId).emit('room:emote', { playerId: payload.playerId, emote: payload.emote, timestamp: now })
        }
      }
      ack?.({ ok: true })
    } catch (err) {
      ack?.({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('room:pause', async (raw: unknown, ack?: (res: { ok?: true; error?: string }) => void) => {
    const payload = parseAndAuth(RoomPauseSchema, raw, ack, socket)
    if (!payload) return
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
  })

  socket.on('room:join', async (raw: unknown, ack: (res: { ok?: true; error?: string }) => void) => {
    const payload = parseAndAuth(RoomJoinSchema, raw, ack, socket)
    if (!payload) return
    try {
      const [deck, arena] = await Promise.all([lookupDeck(payload.playerId), lookupArena(payload.playerId)])
      const state = await lobby.withRoomLock(payload.roomId, async () => {
        const next = await lobby.joinRoom(payload.roomId, { ...payload, deck, arena })
        const player = next.players.find(p => p.id === payload.playerId)
        if (player) {
          player.socketId = socket.id
          player.deck = deck
          player.arena = arena
        }
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
  })

  socket.on('room:spectate', async (raw: unknown, ack: (res: { ok?: true; error?: string }) => void) => {
    const payload = parseAndAuth(RoomSpectateSchema, raw, ack, socket)
    if (!payload) return
    try {
      const state = await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        if (room.players.some(p => p.id === payload.playerId)) throw new Error('ALREADY_PLAYER')
        const spectators = room.spectators ?? []
        const existing = spectators.find(s => s.id === payload.playerId)
        let next
        if (existing) {
          existing.socketId = socket.id
          existing.skin = 'default'
          next = { ...room, spectators: [...spectators] }
        } else {
          next = {
            ...room,
            spectators: [...spectators, { id: payload.playerId, name: 'Espectador', socketId: socket.id, skin: 'default' }],
          }
        }
        await lobby.setRoom(next)
        return next
      })
      socket.join(payload.roomId)
      await lobby.bindSocket(socket.id, payload.roomId, payload.playerId)
      ack({ ok: true })
      socket.emit('room:state', { state: redactStateForPlayer(state, payload.playerId, true) })
      io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
      console.log(`[room:spectate] socket=${socket.id} player=${payload.playerId} room=${payload.roomId}`)
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('room:leave', async (raw: unknown, ack: (res: { ok?: true; error?: string }) => void) => {
    const payload = parseAndAuth(RoomLeaveSchema, raw, ack, socket)
    if (!payload) return
    try {
      const result = await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) return null
        const isSpectator = (room.spectators ?? []).some(s => s.id === payload.playerId)
        if (isSpectator) {
          const next = { ...room, spectators: (room.spectators ?? []).filter(s => s.id !== payload.playerId) }
          await lobby.setRoom(next)
          return next
        }
        const inGame = room.phase !== 'waiting' && room.phase !== 'round-end' && room.phase !== 'match-end'
        if (inGame) {
          const adjusted = removePlayerMidGame(room, payload.playerId)
          await lobby.setRoom(adjusted)
          if (adjusted.players.length === 0) {
            await lobby.removeRoom(payload.roomId)
            return null
          }
          return adjusted
        }
        return await lobby.removePlayer(payload.roomId, payload.playerId) ?? null
      })
      socket.leave(payload.roomId)
      await lobby.releaseSocket(socket.id)
      ack({ ok: true })
      if (result) broadcastRoom(io, result)
      io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
      console.log(`[room:leave] socket=${socket.id} player=${payload.playerId} room=${payload.roomId}`)
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })
}
