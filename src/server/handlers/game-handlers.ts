import type { Server as SocketServer, Socket } from 'socket.io'
import { lobby } from '../lobby'
import { startRound } from '../game/state'
import {
  drawFromDeck, discardDrawnCard, swapAndDiscard,
  snapCard, useHandCardEffect,
  resolveEffect, callCabo, finishRound,
} from '../game/engine'
import { broadcastRoom } from './broadcast'

type Ack = (res: { ok?: true; error?: string; payload?: unknown }) => void

export function registerGameHandlers(io: SocketServer, socket: Socket) {
  socket.on('game:start', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    console.log(`[game:start] socket=${socket.id} player=${payload.playerId} room=${payload.roomId}`)
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        if (room.hostId !== payload.playerId) throw new Error('NOT_HOST')
        if (room.players.length < 2) throw new Error('NEED_2_PLAYERS')
        const next = startRound(room)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
      })
      ack({ ok: true })
    } catch (err) {
      console.log(`[game:start] ERROR ${err instanceof Error ? err.message : 'UNKNOWN'}`)
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:initial-peek-done', async (payload: { roomId: string; playerId: string }, ack?: Ack) => {
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        if (room.phase !== 'initial-peek') throw new Error('INVALID_PHASE')
        if (!room.players.some(p => p.id === payload.playerId)) throw new Error('PLAYER_NOT_FOUND')
        const count = await lobby.addPeekConfirmation(room.roomId, payload.playerId)
        console.log(`[initial-peek-done] room=${room.roomId} player=${payload.playerId} confirmed=${count}/${room.players.length}`)
        if (count >= room.players.length) {
          await lobby.clearPeekConfirmations(room.roomId)
          const next = { ...room, phase: 'playing' as const }
          await lobby.setRoom(next)
          broadcastRoom(io, next)
        }
      })
      ack?.({ ok: true })
    } catch (err) {
      ack?.({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:draw', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    try {
      const card = await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const { state: next, card } = drawFromDeck(room, payload.playerId)
        await lobby.setRoom(next)
        await lobby.setDrawnCard(payload.playerId, { roomId: payload.roomId, card })
        broadcastRoom(io, next)
        return card
      })
      ack({ ok: true, payload: { card } })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:keep-or-discard', async (payload: { roomId: string; playerId: string; action: 'keep' | 'discard'; handIndex?: number }, ack: Ack) => {
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const cached = await lobby.getDrawnCard(payload.playerId)
        if (!cached) throw new Error('NO_DRAWN_CARD')
        const drawnCard = cached.card
        let next
        if (payload.action === 'discard') {
          next = discardDrawnCard(room, payload.playerId, drawnCard)
        } else {
          if (payload.handIndex === undefined) throw new Error('HAND_INDEX_REQUIRED')
          next = swapAndDiscard(room, payload.playerId, drawnCard, payload.handIndex)
        }
        await lobby.setRoom(next)
        await lobby.clearDrawnCard(payload.playerId)
        broadcastRoom(io, next)
      })
      ack({ ok: true })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:snap', async (payload: { roomId: string; playerId: string; handIndex: number }, ack: Ack) => {
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const next = snapCard(room, payload.playerId, payload.handIndex)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
      })
      ack({ ok: true })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:use-hand-effect', async (payload: { roomId: string; playerId: string; handIndex: number }, ack: Ack) => {
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const next = useHandCardEffect(room, payload.playerId, payload.handIndex)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
      })
      ack({ ok: true })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:effect-target', async (payload: { roomId: string; playerId: string; targetPlayerId: string; targetCardIndex: number; myCardIndex?: number }, ack: Ack) => {
    try {
      const revealed = await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const { state: next, revealed } = resolveEffect(room, payload.playerId, payload)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
        return revealed
      })
      ack({ ok: true, payload: { revealed } })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:cabo', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const next = callCabo(room, payload.playerId)
        await lobby.setRoom(next)
        io.to(payload.roomId).emit('game:cabo-called', { callerId: payload.playerId, turnsRemaining: next.turnsRemaining })
        broadcastRoom(io, next)
      })
      ack({ ok: true })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })

  socket.on('game:next-round', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    try {
      await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        if (room.hostId !== payload.playerId) throw new Error('NOT_HOST')
        const ended = finishRound(room)
        if (ended.phase === 'match-end') {
          await lobby.setRoom(ended)
          io.to(payload.roomId).emit('game:match-end', { finalScores: ended.players.map(p => ({ id: p.id, name: p.name, score: p.score })) })
          broadcastRoom(io, ended)
          return
        }
        const next = startRound(ended)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
      })
      ack({ ok: true })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })
}
