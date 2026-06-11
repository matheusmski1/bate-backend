import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server as SocketServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { registerLobbyHandlers } from './handlers/lobby-handlers'
import { registerGameHandlers } from './handlers/game-handlers'
import { broadcastRoom } from './handlers/broadcast'
import { lobby } from './lobby'
import { consume as consumeRate, release as releaseRate } from './rate-limit'
import { log } from './logger'
import { audit, recent as recentAudit, summary as auditSummary } from './audit'
import { metrics } from './metrics'
import { DASHBOARD_HTML } from './dashboard'
import { signGuestToken, sessionCookie, readSessionCookie, verifyToken } from './auth'
import { AppDataSource } from './db/data-source'
import { ensureUser } from './db/users'
import { seedDefaultDecks, backfillDefaultDecksToAllUsers } from './db/seed-decks'
import { seedDefaultArenas, backfillDefaultArenasToAllUsers } from './db/seed-arenas'
import { listDecksForUser, equipDeckForUser } from './db/decks'
import { listArenasForUser, equipArenaForUser } from './db/arenas'
import { removePlayerMidGame, discardDrawnCard, skipEffect, autoPlayExpiredTurn } from './game/engine'
import { markDisconnected, rebindSocket, shouldExpireIdleRoom, lastActivityAt } from './game/state'

const port = Number(process.env.PORT ?? 3001)
const corsOrigin = process.env.CORS_ORIGIN ?? '*'
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN
const IS_PROD = process.env.NODE_ENV === 'production'
const ALLOWED_ORIGINS: ReadonlyArray<string> = (() => {
  const fromEnv = (process.env.CORS_ORIGIN ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const devDefaults = ['http://localhost:3000', 'http://127.0.0.1:3000']
  return [...new Set([...fromEnv, ...devDefaults])]
})()

function isOriginAllowed(origin: string | undefined): boolean {
  if (corsOrigin === '*') return true
  if (!origin) return false
  return ALLOWED_ORIGINS.includes(origin)
}
const RECONNECT_GRACE_MS = 30_000
const IDLE_ROOM_MS = Number(process.env.ROOM_IDLE_MS ?? 5 * 60 * 1000)
const CLEANUP_INTERVAL_MS = Number(process.env.ROOM_CLEANUP_INTERVAL_MS ?? 30_000)

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin
  if (!origin || !isOriginAllowed(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return true
  }
  return false
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders(req),
    ...extraHeaders,
  })
  res.end(JSON.stringify(payload))
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (applyCors(req, res)) return
  if (req.url === '/auth/guest') {
    const dbReady = AppDataSource.isInitialized
    const existing = readSessionCookie(req.headers.cookie)
    const respond = async (playerId: string, kind: 'guest', expiresAt: number, extraHeaders: Record<string, string> = {}) => {
      if (dbReady) {
        try {
          await ensureUser(playerId)
        } catch (err) {
          console.error('[auth/guest] ensureUser failed:', err)
        }
      }
      sendJson(req, res, 200, { playerId, kind, expiresAt }, extraHeaders)
    }
    if (existing) {
      const claims = verifyToken(existing)
      if (claims) {
        void respond(claims.sub, claims.kind, claims.exp * 1000)
        return
      }
    }
    const { token, playerId, expiresAt } = signGuestToken()
    const requestHost = (req.headers.host ?? '').split(':')[0]
    const setCookie = sessionCookie(token, { secure: IS_PROD, domain: COOKIE_DOMAIN, requestHost })
    void respond(playerId, 'guest', expiresAt, { 'Set-Cookie': setCookie })
    return
  }
  if (req.url === '/me/decks' && req.method === 'GET') {
    const token = readSessionCookie(req.headers.cookie)
    const claims = token ? verifyToken(token) : null
    if (!claims) { sendJson(req, res, 401, { error: 'UNAUTHORIZED' }); return }
    if (!AppDataSource.isInitialized) { sendJson(req, res, 503, { error: 'DB_UNAVAILABLE' }); return }
    listDecksForUser(claims.sub)
      .then(decks => sendJson(req, res, 200, { decks }))
      .catch(err => {
        console.error('[me/decks] failed:', err)
        sendJson(req, res, 500, { error: 'SERVER_ERROR' })
      })
    return
  }
  if (req.url === '/me/arenas' && req.method === 'GET') {
    const token = readSessionCookie(req.headers.cookie)
    const claims = token ? verifyToken(token) : null
    if (!claims) { sendJson(req, res, 401, { error: 'UNAUTHORIZED' }); return }
    if (!AppDataSource.isInitialized) { sendJson(req, res, 503, { error: 'DB_UNAVAILABLE' }); return }
    listArenasForUser(claims.sub)
      .then(arenas => sendJson(req, res, 200, { arenas }))
      .catch(err => {
        console.error('[me/arenas] failed:', err)
        sendJson(req, res, 500, { error: 'SERVER_ERROR' })
      })
    return
  }
  if (req.url === '/me/equip-deck' && req.method === 'POST') {
    const token = readSessionCookie(req.headers.cookie)
    const claims = token ? verifyToken(token) : null
    if (!claims) { sendJson(req, res, 401, { error: 'UNAUTHORIZED' }); return }
    if (!AppDataSource.isInitialized) { sendJson(req, res, 503, { error: 'DB_UNAVAILABLE' }); return }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      let deckId: string | null = null
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { deckId?: unknown }
        if (typeof body.deckId === 'string' && /^[a-z0-9_-]{1,64}$/.test(body.deckId)) deckId = body.deckId
      } catch { /* invalid json */ }
      if (!deckId) { sendJson(req, res, 400, { error: 'INVALID_DECK_ID' }); return }
      equipDeckForUser(claims.sub, deckId)
        .then(result => {
          if (!result.ok) { sendJson(req, res, 403, { error: result.error }); return }
          sendJson(req, res, 200, { ok: true, equippedDeck: deckId })
        })
        .catch(err => {
          console.error('[me/equip-deck] failed:', err)
          sendJson(req, res, 500, { error: 'SERVER_ERROR' })
        })
    })
    return
  }
  if (req.url === '/me/equip-arena' && req.method === 'POST') {
    const token = readSessionCookie(req.headers.cookie)
    const claims = token ? verifyToken(token) : null
    if (!claims) { sendJson(req, res, 401, { error: 'UNAUTHORIZED' }); return }
    if (!AppDataSource.isInitialized) { sendJson(req, res, 503, { error: 'DB_UNAVAILABLE' }); return }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      let arenaId: string | null = null
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { arenaId?: unknown }
        if (typeof body.arenaId === 'string' && /^[a-z0-9_-]{1,64}$/.test(body.arenaId)) arenaId = body.arenaId
      } catch { /* invalid json */ }
      if (!arenaId) { sendJson(req, res, 400, { error: 'INVALID_ARENA_ID' }); return }
      equipArenaForUser(claims.sub, arenaId)
        .then(result => {
          if (!result.ok) { sendJson(req, res, 403, { error: result.error }); return }
          sendJson(req, res, 200, { ok: true, equippedArena: arenaId })
        })
        .catch(err => {
          console.error('[me/equip-arena] failed:', err)
          sendJson(req, res, 500, { error: 'SERVER_ERROR' })
        })
    })
    return
  }
  if (req.url === '/auth/me') {
    const token = readSessionCookie(req.headers.cookie)
    if (!token) { sendJson(req, res, 401, { error: 'NO_SESSION' }); return }
    const claims = verifyToken(token)
    if (!claims) { sendJson(req, res, 401, { error: 'INVALID_SESSION' }); return }
    sendJson(req, res, 200, { playerId: claims.sub, kind: claims.kind, expiresAt: claims.exp * 1000 })
    return
  }
  if (req.url === '/health') {
    sendJson(req, res, 200, { ok: true, uptime: process.uptime(), pid: process.pid, redis: !!process.env.REDIS_URL })
    return
  }
  if (req.url === '/health/audit') {
    sendJson(req, res, 200, { summary: auditSummary(), recent: recentAudit(50) })
    return
  }
  if (req.url === '/health/metrics') {
    lobby.listRooms()
      .then(rooms => sendJson(req, res, 200, { ...metrics.snapshot(), rooms: rooms.length }))
      .catch(() => sendJson(req, res, 200, metrics.snapshot()))
    return
  }
  if (req.url === '/health/dashboard') {
    void (async () => {
      const summaries = await lobby.listRooms()
      const rooms = []
      for (const summary of summaries.slice(0, 50)) {
        const room = await lobby.getRoom(summary.roomId)
        if (!room) continue
        const turnPlayerId = room.players[room.turn]?.id ?? null
        rooms.push({
          roomId: room.roomId,
          name: room.name,
          phase: room.phase,
          paused: room.paused,
          roundNumber: room.roundNumber,
          roundStartedAt: room.roundStartedAt,
          turnDeadlineAt: room.turnDeadlineAt,
          maxPlayers: room.maxPlayers,
          spectators: room.spectators?.length ?? 0,
          players: room.players.map(p => ({
            name: p.name,
            connected: p.connected,
            score: p.score,
            isTurn: p.id === turnPlayerId,
          })),
        })
      }
      sendJson(req, res, 200, {
        ...metrics.snapshot(),
        totals: {
          rooms: summaries.length,
          players: summaries.reduce((a, s) => a + s.playerCount, 0),
          spectators: summaries.reduce((a, s) => a + s.spectatorCount, 0),
        },
        rooms,
      })
    })().catch(() => sendJson(req, res, 500, { error: 'SERVER_ERROR' }))
    return
  }
  if (req.url === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders(req) })
    res.end(DASHBOARD_HTML)
    return
  }
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Bate backend OK — Socket.io endpoint em /socket.io/')
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not Found')
})

const io = new SocketServer(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (corsOrigin === '*') return cb(null, true)
      if (!origin) return cb(null, false)
      cb(null, isOriginAllowed(origin))
    },
    credentials: true,
  },
  pingInterval: 25_000,
  pingTimeout: 10_000,
  transports: ['websocket'],
})

if (process.env.DATABASE_URL) {
  try {
    await AppDataSource.initialize()
    console.log('[db] datasource initialized')
    try {
      const seed = await seedDefaultDecks()
      console.log(`[db] seed decks inserted=${seed.inserted} updated=${seed.updated}`)
      const backfill = await backfillDefaultDecksToAllUsers()
      console.log(`[db] backfill decks granted=${backfill.granted}`)
    } catch (err) {
      console.error('[db] seed/backfill decks failed:', err)
    }
    try {
      const seed = await seedDefaultArenas()
      console.log(`[db] seed arenas inserted=${seed.inserted} updated=${seed.updated}`)
      const backfill = await backfillDefaultArenasToAllUsers()
      console.log(`[db] backfill arenas granted=${backfill.granted}`)
    } catch (err) {
      console.error('[db] seed/backfill arenas failed:', err)
    }
  } catch (err) {
    console.error('[db] initialize failed:', err)
    if (IS_PROD) process.exit(1)
  }
} else {
  console.log('[db] DATABASE_URL not set — running without DB (profile features disabled)')
}

if (process.env.REDIS_URL) {
  const pubClient = createClient({ url: process.env.REDIS_URL })
  const subClient = pubClient.duplicate()
  pubClient.on('error', err => console.error('[redis-pub] error', err))
  subClient.on('error', err => console.error('[redis-sub] error', err))
  await Promise.all([pubClient.connect(), subClient.connect()])
  io.adapter(createAdapter(pubClient, subClient))
  console.log('[socket.io] using Redis adapter')
} else {
  console.log('[socket.io] using in-memory adapter (single process only)')
}

const pendingDisconnects = new Map<string, NodeJS.Timeout>()

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin
  if (!isOriginAllowed(origin)) {
    log.warn('socket', 'origin rejected', { socket: socket.id, origin: origin ?? null })
    audit('origin_rejected', socket.id, { origin: origin ?? null })
    next(new Error('ORIGIN_NOT_ALLOWED'))
    return
  }
  next()
})

io.use((socket, next) => {
  const token = readSessionCookie(socket.handshake.headers.cookie)
  if (!token) {
    log.warn('socket', 'no session cookie', { socket: socket.id })
    audit('auth_failure', socket.id, { reason: 'no_cookie' })
    next(new Error('UNAUTHORIZED'))
    return
  }
  const claims = verifyToken(token)
  if (!claims) {
    log.warn('socket', 'invalid session token', { socket: socket.id })
    audit('auth_failure', socket.id, { reason: 'invalid_token' })
    next(new Error('UNAUTHORIZED'))
    return
  }
  socket.data.playerId = claims.sub
  next()
})

io.on('connection', socket => {
  log.info('socket', 'connected', { socket: socket.id })

  const reconnectingPlayerId = socket.data.playerId as string | undefined
  if (reconnectingPlayerId) {
    void (async () => {
      const roomId = await lobby.getPlayerRoom(reconnectingPlayerId)
      if (!roomId) return
      await lobby.withRoomLock(roomId, async () => {
        const room = await lobby.getRoom(roomId)
        if (!room || !room.players.some(p => p.id === reconnectingPlayerId)) {
          await lobby.clearPlayerRoom(reconnectingPlayerId)
          return
        }
        const pending = pendingDisconnects.get(reconnectingPlayerId)
        if (pending) {
          clearTimeout(pending)
          pendingDisconnects.delete(reconnectingPlayerId)
        }
        const next = rebindSocket(room, reconnectingPlayerId, socket.id)
        await lobby.setRoom(next)
        socket.join(roomId)
        await lobby.bindSocket(socket.id, roomId, reconnectingPlayerId)
        log.info('reconnect', 'auto-rebind', { player: reconnectingPlayerId, room: roomId, socket: socket.id })
        broadcastRoom(io, next)
      })
    })().catch(err => log.error('reconnect', 'auto-rebind failed', { error: err instanceof Error ? err.message : 'UNKNOWN' }))
  }

  socket.use(([eventName], next) => {
    const event = typeof eventName === 'string' ? eventName : '__global'
    if (!consumeRate(socket.id, event)) {
      log.warn('rate-limit', 'dropping event', { socket: socket.id, event })
      audit('rate_limit_hit', socket.id, { event })
      next(new Error('RATE_LIMITED'))
      return
    }
    next()
  })
  registerLobbyHandlers(io, socket)
  registerGameHandlers(io, socket)

  socket.on('disconnect', async reason => {
    releaseRate(socket.id)
    const entry = await lobby.releaseSocket(socket.id)
    log.info('socket', 'disconnected', { socket: socket.id, reason, binding: entry ?? null })
    if (!entry) return
    await lobby.withRoomLock(entry.roomId, async () => {
      const room = await lobby.getRoom(entry.roomId)
      if (!room) return
      const spectatorIdx = (room.spectators ?? []).findIndex(s => s.id === entry.playerId && s.socketId === socket.id)
      if (spectatorIdx !== -1) {
        const next = { ...room, spectators: (room.spectators ?? []).filter((_, i) => i !== spectatorIdx) }
        await lobby.setRoom(next)
        broadcastRoom(io, next)
        return
      }
      const player = room.players.find(p => p.id === entry.playerId)
      if (!player || player.socketId !== socket.id) return
      const next = markDisconnected(room, entry.playerId, Date.now())
      await lobby.setRoom(next)
      broadcastRoom(io, next)
    })

    const existing = pendingDisconnects.get(entry.playerId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(async () => {
      await lobby.withRoomLock(entry.roomId, async () => {
        const r = await lobby.getRoom(entry.roomId)
        if (!r) return
        const p = r.players.find(x => x.id === entry.playerId)
        if (!p || p.connected) return
        p.socketId = null
        log.warn('reconnect-grace', 'expired', { player: entry.playerId, room: entry.roomId, phase: r.phase })
        if (r.phase === 'waiting' || r.phase === 'round-end' || r.phase === 'match-end') {
          const next = await lobby.removePlayer(entry.roomId, entry.playerId)
          if (next) broadcastRoom(io, next)
          else log.warn('reconnect-grace', 'removePlayer killed room', { room: entry.roomId })
        } else {
          const adjusted = removePlayerMidGame(r, entry.playerId)
          await lobby.setRoom(adjusted)
          if (adjusted.players.length === 0) await lobby.removeRoom(entry.roomId)
          else if (adjusted.players.length !== r.players.length) {
            const stillThere = adjusted.players.length
            log.info('reconnect-grace', 'player removed mid-game', { player: entry.playerId, remaining: stillThere, phase: adjusted.phase })
            broadcastRoom(io, adjusted)
          } else {
            broadcastRoom(io, r)
          }
        }
      })
      pendingDisconnects.delete(entry.playerId)
    }, RECONNECT_GRACE_MS)
    pendingDisconnects.set(entry.playerId, timer)
  })
})

setInterval(async () => {
  const now = Date.now()
  const summaries = await lobby.listRooms()
  if (summaries.length > 0) {
    log.info('cleanup', 'tick', { rooms: summaries.length, idleLimitMs: IDLE_ROOM_MS })
  }
  for (const summary of summaries) {
    const room = await lobby.getRoom(summary.roomId)
    if (!room) continue
    const isConnected = (socketId: string | null) => !!socketId && io.sockets.sockets.has(socketId)
    if (shouldExpireIdleRoom(room, now, IDLE_ROOM_MS, isConnected)) {
      const idleSec = Math.round((now - lastActivityAt(room)) / 1000)
      log.warn('cleanup', 'expiring idle room', { room: summary.roomId, idleSec, phase: room.phase, players: room.players.length })
      for (const player of room.players) {
        if (player.socketId && io.sockets.sockets.has(player.socketId)) {
          io.to(player.socketId).emit('room:expired', {
            roomId: summary.roomId,
            reason: 'idle',
            message: `Sala fechada por inatividade (${Math.floor(IDLE_ROOM_MS / 60000)}min sem ações).`,
          })
        }
      }
      await lobby.removeRoom(summary.roomId)
      io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
    }
  }
}, CLEANUP_INTERVAL_MS)

const TURN_TIMER_INTERVAL_MS = 2_000

setInterval(async () => {
  const due = await lobby.getRoomsWithExpiredDeadline(Date.now())
  for (const candidate of due) {
    await lobby.withRoomLock(candidate.roomId, async () => {
      const r2 = await lobby.getRoom(candidate.roomId)
      if (!r2 || r2.paused || r2.turnDeadlineAt === null || r2.turnDeadlineAt > Date.now()) return
      const playerId = r2.players[r2.turn]?.id
      if (!playerId) return
      log.warn('turn-timer', 'expired — auto-action', { room: candidate.roomId, player: playerId, phase: r2.phase })
      let next = r2
      if (r2.phase === 'effect-pending' && r2.pendingEffect?.playerId === playerId) {
        next = skipEffect(r2, playerId)
      } else {
        const cached = await lobby.getDrawnCard(playerId)
        if (cached) {
          next = discardDrawnCard(r2, playerId, cached.card, false)
          await lobby.clearDrawnCard(playerId)
        } else {
          const result = autoPlayExpiredTurn(r2)
          next = result.state
        }
      }
      await lobby.setRoom(next)
      broadcastRoom(io, next)
    })
  }
}, TURN_TIMER_INTERVAL_MS)

const server = httpServer.listen(port, '0.0.0.0', () => {
  console.log(`> Bate backend ready on port ${port} (cors=${corsOrigin})`)
})

function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing gracefully...`)
  io.emit('server:shutdown', { message: 'Servidor reiniciando.' })
  io.close(() => console.log('[shutdown] socket.io closed'))
  server.close(() => {
    console.log('[shutdown] http closed, bye')
    process.exit(0)
  })
  setTimeout(() => {
    console.log('[shutdown] force exit after timeout')
    process.exit(1)
  }, 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
