import { performance } from 'node:perf_hooks'
import { io, type Socket } from 'socket.io-client'
import type { Metrics } from './metrics'

type State = {
  roomId: string
  phase: string
  turn: number
  roundNumber: number
  players: Array<{ id: string }>
  pendingEffect: { playerId: string } | null
}

type Ack = { ok?: true; error?: string; roomId?: string; payload?: { card?: unknown } }

const ORIGIN = process.env.LOADTEST_ORIGIN ?? 'http://localhost:3000'
const THINK_MS = Number(process.env.LOADTEST_THINK_MS ?? 500)
const ACK_TIMEOUT_MS = Number(process.env.LOADTEST_ACK_TIMEOUT_MS ?? 8000)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export class Bot {
  socket: Socket | null = null
  playerId = ''
  roomId = ''
  lastStateAt = 0
  isHost = false

  private acting = false
  private peekRound = -1
  private nextRoundRequested = -1
  private onMatchEnd: () => void = () => {}

  constructor(
    private readonly baseUrl: string,
    readonly name: string,
    private readonly metrics: Metrics,
  ) {}

  async connect(): Promise<void> {
    const session = await getGuestSession(this.baseUrl)
    this.playerId = session.playerId
    const socket = io(this.baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: session.cookie, Origin: ORIGIN },
    })
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), ACK_TIMEOUT_MS)
      socket.once('connect', () => { clearTimeout(timer); resolve() })
      socket.once('connect_error', err => { clearTimeout(timer); reject(err) })
    })
    socket.on('room:state', (msg: { state: State }) => this.onState(msg.state))
  }

  whenMatchEnds(callback: () => void): void {
    this.onMatchEnd = callback
  }

  emitAck(event: string, payload: Record<string, unknown>): Promise<Ack> {
    const socket = this.socket
    if (!socket) return Promise.reject(new Error('NOT_CONNECTED'))
    return new Promise<Ack>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('ACK_TIMEOUT')) }
      }, ACK_TIMEOUT_MS)
      socket.emit(event, payload, (res: Ack) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(res ?? {})
      })
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  private onState(state: State): void {
    this.lastStateAt = performance.now()
    const meIdx = state.players.findIndex(p => p.id === this.playerId)
    if (meIdx === -1) return

    if (state.phase === 'initial-peek') {
      if (this.peekRound !== state.roundNumber) {
        this.peekRound = state.roundNumber
        void this.fireAndForget('game:initial-peek-done', state.roomId)
      }
      return
    }
    if (state.phase === 'round-end') {
      if (this.isHost && this.nextRoundRequested !== state.roundNumber) {
        this.nextRoundRequested = state.roundNumber
        void this.fireAndForget('game:next-round', state.roomId)
      }
      return
    }
    if (state.phase === 'match-end') {
      this.onMatchEnd()
      return
    }
    if (state.phase === 'effect-pending') {
      if (state.pendingEffect?.playerId === this.playerId && !this.acting) {
        void this.fireAndForget('game:skip-effect', state.roomId)
      }
      return
    }
    if (state.phase === 'playing' || state.phase === 'bate-called') {
      if (state.turn === meIdx && !this.acting) void this.takeTurn(state.roomId)
    }
  }

  private async takeTurn(roomId: string): Promise<void> {
    this.acting = true
    try {
      if (THINK_MS > 0) await sleep(THINK_MS)
      const t0 = performance.now()
      const drawRes = await this.emitAck('game:draw', { roomId, playerId: this.playerId })
      this.metrics.record('draw', performance.now() - t0)
      if (drawRes.error) { this.metrics.recordError(); return }
      if (!drawRes.payload?.card) return
      const t1 = performance.now()
      const keepRes = await this.emitAck('game:keep-or-discard', {
        roomId,
        playerId: this.playerId,
        action: 'discard',
        useEffect: false,
      })
      this.metrics.record('keep', performance.now() - t1)
      if (keepRes.error) this.metrics.recordError()
    } catch {
      this.metrics.recordError()
    } finally {
      this.acting = false
    }
  }

  private async fireAndForget(event: string, roomId: string): Promise<void> {
    try {
      await this.emitAck(event, { roomId, playerId: this.playerId })
    } catch {
      this.metrics.recordError()
    }
  }
}

async function getGuestSession(baseUrl: string): Promise<{ playerId: string; cookie: string }> {
  const res = await fetch(`${baseUrl}/auth/guest`, { method: 'GET' })
  if (!res.ok) throw new Error(`AUTH_FAILED:${res.status}`)
  const body = (await res.json()) as { playerId: string }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  const cookie = (setCookies[0] ?? '').split(';')[0] ?? ''
  if (!cookie) throw new Error('NO_SESSION_COOKIE')
  return { playerId: body.playerId, cookie }
}
