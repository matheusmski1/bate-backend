import { performance } from 'node:perf_hooks'
import { Bot } from './bot'
import type { Metrics } from './metrics'

const MAX_SESSION_MS = Number(process.env.LOADTEST_MAX_SESSION_MS ?? 180000)
const WATCHDOG_MS = Number(process.env.LOADTEST_WATCHDOG_MS ?? 20000)
const TURN_LIMIT_SEC = Number(process.env.LOADTEST_TURN_LIMIT_SEC ?? 600)

let roomCounter = 0

export async function runRoomSession(baseUrl: string, metrics: Metrics): Promise<void> {
  const id = ++roomCounter
  const bots = [0, 1, 2, 3].map(i => new Bot(baseUrl, `b${id}-${i}`, metrics))
  const host = bots[0]!
  host.isHost = true

  try {
    await host.connect()
    const created = await host.emitAck('room:create', {
      name: `load-${id}`.slice(0, 40),
      hostId: host.playerId,
      hostName: host.name.slice(0, 20),
      maxPlayers: 4,
      turnTimeLimitSec: TURN_LIMIT_SEC,
    })
    if (!created.roomId) throw new Error(created.error ?? 'CREATE_FAILED')
    const roomId = created.roomId
    for (const bot of bots) bot.roomId = roomId

    await host.emitAck('room:join', { roomId, playerId: host.playerId, playerName: host.name.slice(0, 20) })
    for (const bot of bots.slice(1)) {
      await bot.connect()
      await bot.emitAck('room:join', { roomId, playerId: bot.playerId, playerName: bot.name.slice(0, 20) })
    }

    let cap: ReturnType<typeof setTimeout> | null = null
    let watchdog: ReturnType<typeof setInterval> | null = null
    const finished = new Promise<void>(resolve => {
      let done = false
      const finish = (): void => { if (!done) { done = true; resolve() } }
      for (const bot of bots) bot.whenMatchEnds(finish)
      cap = setTimeout(finish, MAX_SESSION_MS)
      watchdog = setInterval(() => {
        const last = Math.max(0, ...bots.map(b => b.lastStateAt))
        if (last > 0 && performance.now() - last > WATCHDOG_MS) finish()
      }, 2000)
    })

    await host.emitAck('game:start', { roomId, playerId: host.playerId })
    await finished
    if (cap) clearTimeout(cap)
    if (watchdog) clearInterval(watchdog)
  } finally {
    for (const bot of bots) bot.disconnect()
  }
}
