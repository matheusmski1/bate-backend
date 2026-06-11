import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import { io, type Socket } from 'socket.io-client'

const PORT = 3099
const BASE = `http://localhost:${PORT}`
const ORIGIN = 'http://localhost:3000'

const run = process.env.TEST_E2E ? describe : describe.skip

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await delay(500)
  }
  throw new Error('server nao subiu')
}

async function guestSession(): Promise<{ playerId: string; cookie: string }> {
  const res = await fetch(`${BASE}/auth/guest`)
  const body = (await res.json()) as { playerId: string }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  const cookie = (setCookies[0] ?? '').split(';')[0] ?? ''
  return { playerId: body.playerId, cookie }
}

function connect(cookie: string): Promise<Socket> {
  const socket = io(BASE, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Cookie: cookie, Origin: ORIGIN },
  })
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 8000)
    socket.once('connect', () => { clearTimeout(t); resolve(socket) })
    socket.once('connect_error', err => { clearTimeout(t); reject(err) })
  })
}

function emitAck(socket: Socket, event: string, payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000)
    socket.emit(event, payload, (res: unknown) => { clearTimeout(t); resolve(res) })
  })
}

function waitForEvent(socket: Socket, event: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`evento "${event}" nao chegou em ${timeoutMs}ms (FREEZE)`)), timeoutMs)
    socket.once(event, (payload: unknown) => { clearTimeout(t); resolve(payload) })
  })
}

run('reconexao recupera a partida sem F5', () => {
  let server: ChildProcess

  beforeAll(async () => {
    const logFd = openSync('/tmp/e2e-srv.log', 'w')
    server = spawn('npx', ['tsx', 'src/server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'info', NODE_ENV: 'test', DATABASE_URL: '', REDIS_URL: '' },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    })
    await waitForHealth()
  }, 40000)

  afterAll(() => {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGKILL') } catch { /* group gone */ }
    }
  })

  it('socket reconectado recebe o estado automaticamente, sem precisar re-emitir room:join', async () => {
    const host = await guestSession()
    const hostSocket = await connect(host.cookie)
    const created = await emitAck(hostSocket, 'room:create', {
      name: 'e2e', hostId: host.playerId, hostName: 'Host', maxPlayers: 4, turnTimeLimitSec: 600,
    })
    const roomId = created.roomId as string
    expect(roomId).toBeTruthy()
    await emitAck(hostSocket, 'room:join', { roomId, playerId: host.playerId, playerName: 'Host' })

    const guest = await guestSession()
    const guestSocket = await connect(guest.cookie)
    await emitAck(guestSocket, 'room:join', { roomId, playerId: guest.playerId, playerName: 'Guest' })

    guestSocket.disconnect()
    await delay(400)

    const guest2 = io(BASE, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: guest.cookie, Origin: ORIGIN },
    })
    const recovered = new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('room:state nao chegou em 3000ms (FREEZE)')), 3000)
      guest2.once('room:state', (payload: unknown) => { clearTimeout(t); resolve(payload) })
      guest2.once('connect_error', err => { clearTimeout(t); reject(err) })
    })

    const payload = await recovered
    expect(payload.state.roomId).toBe(roomId)
    expect(payload.state.players.some((p: { id: string }) => p.id === guest.playerId)).toBe(true)

    hostSocket.disconnect()
    guest2.disconnect()
  }, 25000)
})
