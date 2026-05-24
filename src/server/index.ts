import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Server as SocketServer } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { createClient } from 'redis'
import { registerLobbyHandlers } from './handlers/lobby-handlers'
import { registerGameHandlers } from './handlers/game-handlers'
import { broadcastRoom } from './handlers/broadcast'
import { lobby } from './lobby'
import { consume as consumeRate, release as releaseRate } from './rate-limit'

const port = Number(process.env.PORT ?? 3001)
const corsOrigin = process.env.CORS_ORIGIN ?? '*'
const RECONNECT_GRACE_MS = 30_000
const IDLE_ROOM_MS = 5 * 60 * 1000
const CLEANUP_INTERVAL_MS = 30_000

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), pid: process.pid, redis: !!process.env.REDIS_URL }))
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
  cors: { origin: corsOrigin, credentials: false },
  pingInterval: 25_000,
  pingTimeout: 10_000,
  transports: ['websocket'],
})

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

io.on('connection', socket => {
  console.log('[socket] connected', socket.id)
  socket.use((_event, next) => {
    if (!consumeRate(socket.id)) {
      console.log('[rate-limit] dropping event from', socket.id)
      next(new Error('RATE_LIMITED'))
      return
    }
    next()
  })
  registerLobbyHandlers(io, socket)
  registerGameHandlers(io, socket)

  socket.on('disconnect', async reason => {
    releaseRate(socket.id)
    console.log('[socket] disconnected', socket.id, reason)
    const entry = await lobby.releaseSocket(socket.id)
    if (!entry) return
    await lobby.withRoomLock(entry.roomId, async () => {
      const room = await lobby.getRoom(entry.roomId)
      if (!room) return
      const player = room.players.find(p => p.id === entry.playerId)
      if (!player || player.socketId !== socket.id) return
      player.connected = false
      player.disconnectedAt = Date.now()
      await lobby.setRoom(room)
      broadcastRoom(io, room)
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
        console.log('[reconnect-grace] expired', entry.playerId, 'room', entry.roomId)
        if (r.phase === 'waiting') {
          const next = await lobby.removePlayer(entry.roomId, entry.playerId)
          if (next) broadcastRoom(io, next)
        } else {
          await lobby.setRoom(r)
          broadcastRoom(io, r)
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
  for (const summary of summaries) {
    const room = await lobby.getRoom(summary.roomId)
    if (!room) continue
    const lastActivity = Math.max(room.createdAt, ...room.log.map(l => l.timestamp))
    if (now - lastActivity > IDLE_ROOM_MS) {
      const idleSec = Math.round((now - lastActivity) / 1000)
      console.log('[cleanup] expiring idle room', summary.roomId, 'idle for', idleSec, 's')
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
