import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import { connect, guestSession, emitAck, waitForRoomState, waitForHealth, delay } from './helpers'

const PORT = 3098
const BASE = `http://localhost:${PORT}`
const run = process.env.TEST_E2E ? describe : describe.skip

run('SALA-2: assento fantasma', () => {
  let server: ChildProcess

  beforeAll(async () => {
    const logFd = openSync('/tmp/e2e-ghost.log', 'w')
    server = spawn('npx', ['tsx', 'src/server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'info', NODE_ENV: 'test', DATABASE_URL: '', REDIS_URL: '' },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    })
    await waitForHealth(BASE)
  }, 40000)

  afterAll(() => {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGKILL') } catch { /* group gone */ }
    }
  })

  async function roomWithGuest() {
    const host = await guestSession(BASE)
    const hostSocket = await connect(BASE, host.cookie)
    const created = await emitAck(hostSocket, 'room:create', {
      name: 'ghost', hostId: host.playerId, hostName: 'Host', maxPlayers: 4, turnTimeLimitSec: 600,
    })
    const roomId = created.roomId as string
    await emitAck(hostSocket, 'room:join', { roomId, playerId: host.playerId, playerName: 'Host' })
    const guest = await guestSession(BASE)
    const guestSocket = await connect(BASE, guest.cookie)
    await emitAck(guestSocket, 'room:join', { roomId, playerId: guest.playerId, playerName: 'Guest' })
    return { host, hostSocket, guest, guestSocket, roomId }
  }

  const semGuest = (s: { players: { name: string }[] }) => !s.players.some(p => p.name === 'Guest')

  it('room:leave explicito em waiting remove o assento', async () => {
    const { hostSocket, guest, guestSocket, roomId } = await roomWithGuest()
    const left = waitForRoomState(hostSocket, semGuest, 4000)
    await emitAck(guestSocket, 'room:leave', { roomId, playerId: guest.playerId })
    await left
    hostSocket.disconnect(); guestSocket.disconnect()
    await delay(100)
  }, 25000)
})
