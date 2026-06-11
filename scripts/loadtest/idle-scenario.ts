import { Bot } from './bot'
import { Metrics } from './metrics'

const BASE_URL = process.env.LOADTEST_URL ?? process.env.SOCKET_URL ?? 'http://localhost:3001'
const ROOMS = Number(process.env.IDLE_ROOMS ?? 200)
const PLAYERS_PER_ROOM = Number(process.env.IDLE_PLAYERS_PER_ROOM ?? 2)
const IDLE_WINDOW_MS = Number(process.env.IDLE_WINDOW_MS ?? 8000)
const POLL_MS = Number(process.env.IDLE_POLL_MS ?? 1000)
const REAP_MARGIN_MS = Number(process.env.IDLE_REAP_MARGIN_MS ?? 6000)

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function liveRooms(): Promise<number> {
  const res = await fetch(`${BASE_URL}/health/metrics`)
  const body = (await res.json()) as { rooms?: number }
  return body.rooms ?? -1
}

async function pollRoomsFor(durationMs: number): Promise<{ min: number; max: number; samples: number[] }> {
  const samples: number[] = []
  const until = Date.now() + durationMs
  while (Date.now() < until) {
    samples.push(await liveRooms())
    await sleep(POLL_MS)
  }
  return { min: Math.min(...samples), max: Math.max(...samples), samples }
}

async function buildIdleRoom(metrics: Metrics): Promise<Bot[]> {
  const bots = Array.from({ length: PLAYERS_PER_ROOM }, (_, i) => new Bot(BASE_URL, `idle-${i}-${Math.round(performance.now())}-${Math.floor(Math.random() * 1e6)}`, metrics))
  const host = bots[0]!
  host.isHost = true
  await host.connect()
  const created = await host.emitAck('room:create', {
    name: 'idle',
    hostId: host.playerId,
    hostName: host.name.slice(0, 20),
    maxPlayers: 4,
    turnTimeLimitSec: 600,
  })
  if (!created.roomId) throw new Error(created.error ?? 'CREATE_FAILED')
  const roomId = created.roomId
  for (const bot of bots) bot.roomId = roomId
  await host.emitAck('room:join', { roomId, playerId: host.playerId, playerName: host.name.slice(0, 20) })
  for (const bot of bots.slice(1)) {
    await bot.connect()
    await bot.emitAck('room:join', { roomId, playerId: bot.playerId, playerName: bot.name.slice(0, 20) })
  }
  return bots
}

async function main(): Promise<void> {
  const metrics = new Metrics()
  console.log(`[idle] alvo=${BASE_URL}  salas=${ROOMS}  jogadores/sala=${PLAYERS_PER_ROOM}`)
  console.log(`[idle] janela ociosa=${IDLE_WINDOW_MS / 1000}s  poll=${POLL_MS}ms  margem reap=${REAP_MARGIN_MS / 1000}s\n`)

  const baseline = await liveRooms()
  console.log(`[idle] salas antes do teste: ${baseline}`)

  const rooms = await Promise.all(Array.from({ length: ROOMS }, () => buildIdleRoom(metrics)))
  const allBots = rooms.flat()
  await sleep(1000)
  const created = await liveRooms()
  console.log(`[idle] ${ROOMS} salas criadas, conectadas e ociosas (em waiting) — server reporta ${created} salas\n`)

  console.log(`[fase A] mantendo tudo conectado e ocioso por ${(IDLE_WINDOW_MS * 2) / 1000}s (2× a janela)…`)
  const a = await pollRoomsFor(IDLE_WINDOW_MS * 2)
  const survived = a.min >= baseline + ROOMS
  console.log(`  contagem de salas: min=${a.min} max=${a.max} (esperado >= ${baseline + ROOMS})`)
  console.log(`  ${survived ? '✅ PASS' : '❌ FAIL'} — salas conectadas ${survived ? 'sobreviveram' : 'foram REAPADAS indevidamente'}\n`)

  console.log('[fase B] desconectando todos os bots (salas viram abandonadas)…')
  for (const bot of allBots) bot.disconnect()
  await sleep(IDLE_WINDOW_MS + REAP_MARGIN_MS)
  const afterReap = await liveRooms()
  const reaped = afterReap <= baseline
  console.log(`  salas após desconexão + janela: ${afterReap} (esperado <= ${baseline})`)
  console.log(`  ${reaped ? '✅ PASS' : '❌ FAIL'} — salas abandonadas ${reaped ? 'foram limpas' : 'NÃO foram limpas'}\n`)

  console.log('───────────────────────────────────────────────')
  const ok = survived && reaped
  console.log(ok ? '🎯 RESULTADO: PASS — gate de conexão segura sob carga' : '💥 RESULTADO: FAIL')
  await sleep(300)
  process.exit(ok ? 0 : 1)
}

main().catch(err => {
  console.error('[idle] fatal', err)
  process.exit(1)
})
