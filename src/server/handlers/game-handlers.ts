import type { Server as SocketServer, Socket } from 'socket.io'
import { lobby } from '../lobby'
import { startRound } from '../game/state'
import {
  drawFromDeck, discardDrawnCard, swapAndDiscard,
  snapCard,
  resolveEffect, skipEffect, callCabo, finishRound,
} from '../game/engine'
import { broadcastRoom } from './broadcast'
import { log, snapshot } from '../logger'

type Ack = (res: { ok?: true; error?: string; payload?: unknown }) => void

async function trace<T>(
  event: string,
  socket: Socket,
  payload: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const t0 = Date.now()
  log.info(event, 'in', { socket: socket.id, ...payload })
  try {
    const result = await fn()
    log.info(event, 'ok', { socket: socket.id, ms: Date.now() - t0 })
    return { ok: true, result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN'
    log.error(event, 'fail', { socket: socket.id, ms: Date.now() - t0, error: msg, ...payload })
    return { ok: false, error: msg }
  }
}

export function registerGameHandlers(io: SocketServer, socket: Socket) {
  socket.on('game:start', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    const r = await trace('game:start', socket, { room: payload.roomId, player: payload.playerId }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        if (room.hostId !== payload.playerId) throw new Error('NOT_HOST')
        if (room.players.length < 2) throw new Error('NEED_2_PLAYERS')
        const next = startRound(room)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
        log.info('game:start', 'state', { room: payload.roomId, after: snapshot(next) })
      })
    })
    ack(r.ok ? { ok: true } : { error: r.error })
  })

  socket.on('game:initial-peek-done', async (payload: { roomId: string; playerId: string }, ack?: Ack) => {
    const r = await trace('game:initial-peek-done', socket, { room: payload.roomId, player: payload.playerId }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        if (room.phase !== 'initial-peek') throw new Error('INVALID_PHASE')
        if (!room.players.some(p => p.id === payload.playerId)) throw new Error('PLAYER_NOT_FOUND')
        const count = await lobby.addPeekConfirmation(room.roomId, payload.playerId)
        log.info('game:initial-peek-done', 'progress', { room: room.roomId, player: payload.playerId, confirmed: count, total: room.players.length })
        if (count >= room.players.length) {
          await lobby.clearPeekConfirmations(room.roomId)
          const next = { ...room, phase: 'playing' as const }
          await lobby.setRoom(next)
          broadcastRoom(io, next)
        }
      })
    })
    ack?.(r.ok ? { ok: true } : { error: r.error })
  })

  socket.on('game:draw', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    const r = await trace('game:draw', socket, { room: payload.roomId, player: payload.playerId }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        log.info('game:draw', 'state', { room: payload.roomId, before: snapshot(room) })
        const { state: next, card } = drawFromDeck(room, payload.playerId)
        await lobby.setRoom(next)
        if (card) {
          await lobby.setDrawnCard(payload.playerId, { roomId: payload.roomId, card })
        } else {
          log.warn('game:draw', 'deck empty — ending round', { room: payload.roomId })
        }
        broadcastRoom(io, next)
        return card
      })
    })
    ack(r.ok ? { ok: true, payload: { card: r.result } } : { error: r.error })
  })

  socket.on('game:keep-or-discard', async (payload: { roomId: string; playerId: string; action: 'keep' | 'discard'; handIndex?: number }, ack: Ack) => {
    const r = await trace('game:keep-or-discard', socket, { room: payload.roomId, player: payload.playerId, action: payload.action, handIndex: payload.handIndex }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
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
        log.info('game:keep-or-discard', 'state', { room: payload.roomId, drawnRank: drawnCard.rank, after: snapshot(next) })
      })
    })
    ack(r.ok ? { ok: true } : { error: r.error })
  })

  socket.on('game:snap', async (payload: { roomId: string; playerId: string; handIndex: number }, ack: Ack) => {
    const r = await trace('game:snap', socket, { room: payload.roomId, player: payload.playerId, handIndex: payload.handIndex }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        log.info('game:snap', 'state', { room: payload.roomId, before: snapshot(room) })
        const next = snapCard(room, payload.playerId, payload.handIndex)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
        const lastEvent = next.log[next.log.length - 1]
        log.info('game:snap', 'state', { room: payload.roomId, outcome: lastEvent?.type, after: snapshot(next) })
      })
    })
    ack(r.ok ? { ok: true } : { error: r.error })
  })

  socket.on('game:skip-effect', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    const r = await trace('game:skip-effect', socket, { room: payload.roomId, player: payload.playerId }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const next = skipEffect(room, payload.playerId)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
      })
    })
    ack(r.ok ? { ok: true } : { error: r.error })
  })

  socket.on('game:effect-target', async (payload: { roomId: string; playerId: string; targetPlayerId: string; targetCardIndex: number; myCardIndex?: number }, ack: Ack) => {
    const r = await trace('game:effect-target', socket, { room: payload.roomId, player: payload.playerId, target: payload.targetPlayerId, targetIdx: payload.targetCardIndex }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const { state: next, revealed } = resolveEffect(room, payload.playerId, payload)
        await lobby.setRoom(next)
        broadcastRoom(io, next)
        return revealed
      })
    })
    ack(r.ok ? { ok: true, payload: { revealed: r.result } } : { error: r.error })
  })

  socket.on('game:cabo', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    const r = await trace('game:cabo', socket, { room: payload.roomId, player: payload.playerId }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
        const room = await lobby.getRoom(payload.roomId)
        if (!room) throw new Error('ROOM_NOT_FOUND')
        const next = callCabo(room, payload.playerId)
        await lobby.setRoom(next)
        io.to(payload.roomId).emit('game:cabo-called', { callerId: payload.playerId, turnsRemaining: next.turnsRemaining })
        broadcastRoom(io, next)
      })
    })
    ack(r.ok ? { ok: true } : { error: r.error })
  })

  socket.on('game:next-round', async (payload: { roomId: string; playerId: string }, ack: Ack) => {
    const r = await trace('game:next-round', socket, { room: payload.roomId, player: payload.playerId }, async () => {
      return await lobby.withRoomLock(payload.roomId, async () => {
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
    })
    ack(r.ok ? { ok: true } : { error: r.error })
  })
}
