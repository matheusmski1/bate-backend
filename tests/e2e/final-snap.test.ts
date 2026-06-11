import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import type { Socket } from 'socket.io-client'
import { connect, guestSession, emitAck, waitForRoomState, waitForHealth, delay } from './helpers'

const PORT = 3099
const BASE = `http://localhost:${PORT}`
const run = process.env.TEST_E2E ? describe : describe.skip

run('FINAL-SNAP: janela final-snap precede round-end', () => {
  let server: ChildProcess

  beforeAll(async () => {
    const logFd = openSync('/tmp/e2e-final-snap.log', 'w')
    server = spawn('npx', ['tsx', 'src/server/index.ts'], {
      env: {
        ...process.env,
        PORT: String(PORT),
        LOG_LEVEL: 'info',
        NODE_ENV: 'test',
        DATABASE_URL: '',
        REDIS_URL: '',
        FINAL_SNAP_WINDOW_MS: '150',
        FINAL_SNAP_EXTEND_MS: '150',
      },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    })
    await waitForHealth(BASE)
  }, 40000)

  afterAll(() => {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGKILL') } catch { /* grupo já encerrado */ }
    }
  })

  type AnyState = {
    phase: string
    players: { id: string; hand: { id: string; hidden?: boolean }[] }[]
    turn: number
    bateCallerId: string | null
    turnsRemaining: number | null
    deckCount: number
    discard: unknown[]
  }

  async function playUntilClose(
    hostSocket: Socket,
    guestSocket: Socket,
    roomId: string,
    hostId: string,
    guestId: string,
    initialState: AnyState,
  ): Promise<void> {
    let latestState: AnyState = initialState

    hostSocket.on('room:state', (payload: { state: AnyState }) => {
      latestState = payload.state
    })
    guestSocket.on('room:state', (payload: { state: AnyState }) => {
      latestState = payload.state
    })

    const CAP = 60
    let turnsSinceBateAvailable = 0

    for (let i = 0; i < CAP; i++) {
      const state: AnyState = latestState

      if (
        state.phase === 'final-snap' ||
        state.phase === 'round-end' ||
        state.phase === 'match-end'
      ) return

      if (state.phase === 'effect-pending') {
        await delay(200)
        continue
      }

      if (
        state.phase !== 'playing' &&
        state.phase !== 'bate-called'
      ) {
        await delay(200)
        continue
      }

      const currentTurnPlayerId: string | undefined = state.players[state.turn]?.id
      if (!currentTurnPlayerId) {
        await delay(100)
        continue
      }

      const isHost = currentTurnPlayerId === hostId
      const activeSocket = isHost ? hostSocket : guestSocket
      const activeId = isHost ? hostId : guestId

      if (state.phase === 'bate-called') {
        const drawResult = await emitAck(activeSocket, 'game:draw', { roomId, playerId: activeId })
        if (drawResult?.error) {
          await delay(1200)
          continue
        }
        await delay(100)
        await emitAck(activeSocket, 'game:keep-or-discard', {
          roomId,
          playerId: activeId,
          action: 'discard',
          useEffect: false,
        })
        await delay(600)
        continue
      }

      if (turnsSinceBateAvailable >= 2 && state.bateCallerId === null) {
        const bateResult = await emitAck(activeSocket, 'game:bate', { roomId, playerId: activeId })
        if (!bateResult?.error) {
          await delay(100)
          continue
        }
      }

      turnsSinceBateAvailable++

      const drawResult = await emitAck(activeSocket, 'game:draw', { roomId, playerId: activeId })
      if (drawResult?.error) {
        await delay(1200)
        continue
      }
      await delay(100)

      const stateAfterDraw: AnyState = latestState
      if (
        stateAfterDraw.phase === 'final-snap' ||
        stateAfterDraw.phase === 'round-end' ||
        stateAfterDraw.phase === 'match-end'
      ) return

      await emitAck(activeSocket, 'game:keep-or-discard', {
        roomId,
        playerId: activeId,
        action: 'discard',
        useEffect: false,
      })
      await delay(600)
    }

    throw new Error(`não alcançou o fechamento do bate em ${CAP} iterações`)
  }

  it('phase torna-se final-snap antes de round-end após sequência de bate', async () => {
    const host = await guestSession(BASE)
    const hostSocket = await connect(BASE, host.cookie)

    const created = await emitAck(hostSocket, 'room:create', {
      name: 'final-snap-test',
      hostId: host.playerId,
      hostName: 'Host',
      maxPlayers: 2,
      turnTimeLimitSec: 600,
    })
    const roomId = created.roomId as string

    await emitAck(hostSocket, 'room:join', { roomId, playerId: host.playerId, playerName: 'Host' })

    const guest = await guestSession(BASE)
    const guestSocket = await connect(BASE, guest.cookie)
    await emitAck(guestSocket, 'room:join', { roomId, playerId: guest.playerId, playerName: 'Guest' })

    await emitAck(hostSocket, 'game:start', { roomId, playerId: host.playerId })

    const playingStatePromise = waitForRoomState(
      hostSocket,
      (s: AnyState) => s.phase === 'playing',
      8000,
    )

    await emitAck(hostSocket, 'game:initial-peek-done', { roomId, playerId: host.playerId })
    await emitAck(guestSocket, 'game:initial-peek-done', { roomId, playerId: guest.playerId })

    const playingState = await playingStatePromise

    const sawFinalSnap = waitForRoomState(guestSocket, (s: { phase: string }) => s.phase === 'final-snap', 12000)
    const sawRoundEnd = waitForRoomState(guestSocket, (s: { phase: string }) => s.phase === 'round-end', 12000)

    await playUntilClose(
      hostSocket,
      guestSocket,
      roomId,
      host.playerId,
      guest.playerId,
      (playingState as { state: AnyState }).state,
    )

    await expect(sawFinalSnap).resolves.toBeTruthy()
    await expect(sawRoundEnd).resolves.toBeTruthy()

    hostSocket.disconnect()
    guestSocket.disconnect()
    await delay(100)
  }, 30000)
})
