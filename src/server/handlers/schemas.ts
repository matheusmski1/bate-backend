import type { Socket } from 'socket.io'
import { z } from 'zod'
import { audit } from '../audit'

const roomId = z.string().regex(/^[A-Z0-9]{4,12}$/, 'invalid roomId')
const playerId = z.string().uuid()
const playerName = z.string().min(1).max(20)
const handIndex = z.number().int().min(0).max(20)

export const RoomCreateSchema = z.object({
  name: z.string().min(1).max(40),
  hostId: playerId,
  hostName: playerName,
  maxPlayers: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  turnTimeLimitSec: z.number().int().min(0).max(600).nullable().optional(),
  private: z.boolean().optional(),
})

export const RoomJoinSchema = z.object({
  roomId,
  playerId,
  playerName,
})

export const RoomLeaveSchema = z.object({
  roomId,
  playerId,
})

export const RoomSpectateSchema = z.object({
  roomId,
  playerId,
})

export const RoomEmoteSchema = z.object({
  roomId,
  playerId,
  emote: z.enum(['clap', 'shock', 'cry', 'fire', 'clock', 'brain']),
})

export const RoomPauseSchema = z.object({
  roomId,
  playerId,
  paused: z.boolean(),
})

export const GameStartSchema = z.object({
  roomId,
  playerId,
})

export const GameInitialPeekDoneSchema = z.object({
  roomId,
  playerId,
})

export const GameDrawSchema = z.object({
  roomId,
  playerId,
})

export const GameKeepOrDiscardSchema = z.object({
  roomId,
  playerId,
  action: z.enum(['keep', 'discard']),
  handIndex: handIndex.optional(),
  useEffect: z.boolean().optional(),
})

export const GameSnapSchema = z.object({
  roomId,
  playerId,
  handIndex,
})

export const GameBateSchema = z.object({
  roomId,
  playerId,
})

export const GameSkipEffectSchema = z.object({
  roomId,
  playerId,
})

export const GameEffectTargetSchema = z.object({
  roomId,
  playerId,
  targetPlayerId: playerId,
  targetCardIndex: handIndex,
  myCardIndex: handIndex.optional(),
})

export const GameNextRoundSchema = z.object({
  roomId,
  playerId,
})

export function parsePayload<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    return { ok: false, error: `INVALID_PAYLOAD:${issue?.path.join('.') ?? 'root'}` }
  }
  return { ok: true, data: result.data }
}

type AnyAck = ((res: { ok?: true; error?: string; roomId?: string; payload?: unknown }) => void) | undefined

export function parseOrAck<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  ack: AnyAck,
  socketId: string | null = null,
): z.infer<S> | null {
  const r = parsePayload(schema, raw)
  if (!r.ok) {
    audit('invalid_payload', socketId, { error: r.error, schema: schema.description ?? 'unknown' })
    ack?.({ error: r.error })
    return null
  }
  return r.data
}

export function parseAndAuth<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  ack: AnyAck,
  socket: Socket,
): (z.infer<S> & { playerId: string; hostId?: string }) | null {
  const data = parseOrAck(schema, raw, ack, socket.id)
  if (!data) return null
  const cookieId = (socket.data as { playerId?: string } | undefined)?.playerId
  if (!cookieId || typeof cookieId !== 'string') {
    audit('auth_failure', socket.id, { reason: 'no_socket_identity' })
    ack?.({ error: 'UNAUTHORIZED' })
    return null
  }
  const obj = data as Record<string, unknown>
  if ('playerId' in obj) obj.playerId = cookieId
  if ('hostId' in obj) obj.hostId = cookieId
  return data as z.infer<S> & { playerId: string; hostId?: string }
}
