import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import { connect, guestSession, emitAck, waitForRoomState, waitForHealth } from './helpers'

const PORT = 3097
const BASE = `http://localhost:${PORT}`
const run = process.env.TEST_E2E ? describe : describe.skip

run('TREINO: humano vs bots', () => {
  let server: ChildProcess

  beforeAll(async () => {
    const logFd = openSync('/tmp/e2e-bot-treino.log', 'w')
    server = spawn('npx', ['tsx', 'src/server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'info', NODE_ENV: 'test', DATABASE_URL: '', REDIS_URL: '', BOT_THINK_MS_OVERRIDE: '20', TURN_TIMER_INTERVAL_MS_OVERRIDE: '100' },
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

  it('cria sala de treino com 2 bots e a rodada avanca ate round-end', async () => {
    const { playerId, cookie } = await guestSession(BASE)
    const socket = await connect(BASE, cookie)
    const reached = waitForRoomState(socket, s => s.phase === 'round-end' || s.phase === 'match-end', 30000)
    const { roomId } = await emitAck(socket, 'room:create-practice', { hostId: playerId, hostName: 'Eu', bots: 2, level: 'hard', turnTimeLimitSec: 1 })
    expect(roomId).toBeTruthy()
    await emitAck(socket, 'game:initial-peek-done', { roomId, playerId })
    const { state } = await reached
    expect(['round-end', 'match-end']).toContain(state.phase)
    socket.close()
  }, 35000)
})
