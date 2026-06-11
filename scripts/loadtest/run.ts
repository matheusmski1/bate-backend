import { performance } from 'node:perf_hooks'
import { runRoomSession } from './room-session'
import { Metrics } from './metrics'
import { summarize, type Summary } from './percentiles'

const BASE_URL = process.env.LOADTEST_URL ?? process.env.SOCKET_URL ?? 'http://localhost:3001'
const STAGES = (process.env.LOADTEST_STAGES ?? '10,50,100,200')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 0)
const HOLD_MS = Number(process.env.LOADTEST_HOLD_MS ?? 30000)
const RAMP_MS = Number(process.env.LOADTEST_RAMP_MS ?? 3000)
const SPAWN_BATCH = Number(process.env.LOADTEST_SPAWN_BATCH ?? 8)
const SPAWN_INTERVAL_MS = Number(process.env.LOADTEST_SPAWN_INTERVAL_MS ?? 300)
const P95_BUDGET_MS = Number(process.env.LOADTEST_P95_BUDGET_MS ?? 200)

const metrics = new Metrics()
const active = new Set<Promise<void>>()
let desired = 0

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function topUp(): void {
  let launched = 0
  while (active.size < desired && launched < SPAWN_BATCH) {
    launched++
    const session = runRoomSession(BASE_URL, metrics)
      .catch(() => metrics.recordError())
      .finally(() => { active.delete(session) })
    active.add(session)
  }
}

type StageReport = { rooms: number; draw: Summary; keep: Summary; errors: number; rps: number }

async function main(): Promise<void> {
  console.log(`[loadtest] alvo=${BASE_URL}`)
  console.log(`[loadtest] estagios=${STAGES.join(' → ')} salas | hold=${HOLD_MS / 1000}s | budget p95=${P95_BUDGET_MS}ms\n`)

  const pump = setInterval(topUp, SPAWN_INTERVAL_MS)
  const report: StageReport[] = []

  for (const rooms of STAGES) {
    desired = rooms
    topUp()
    console.log(`▶ estagio ${rooms} salas (${rooms * 4} jogadores virtuais) — rampa…`)
    await sleep(RAMP_MS)
    metrics.reset()
    const t0 = performance.now()
    await sleep(HOLD_MS)
    const secs = (performance.now() - t0) / 1000
    const draw = summarize(metrics.values('draw'))
    const keep = summarize(metrics.values('keep'))
    const errors = metrics.errors
    const rps = Math.round(metrics.events / secs)
    report.push({ rooms, draw, keep, errors, rps })
    const flag = draw.p95 > P95_BUDGET_MS ? '⚠️ acima do budget' : '✅'
    console.log(`  ativas=${active.size}  throughput≈${rps} ev/s  erros=${errors}`)
    console.log(`  game:draw  p50=${draw.p50}  p95=${draw.p95}  p99=${draw.p99}  max=${draw.max} ms  ${flag}`)
    console.log(`  keep/disc  p50=${keep.p50}  p95=${keep.p95}  p99=${keep.p99}  max=${keep.max} ms\n`)
  }

  desired = 0
  clearInterval(pump)

  console.log('───────────────────────────────────────────────')
  const firstBreak = report.find(r => r.draw.p95 > P95_BUDGET_MS)
  if (firstBreak) {
    console.log(`🎯 Primeiro gargalo: ${firstBreak.rooms} salas (${firstBreak.rooms * 4} jogadores) — p95 do game:draw passou de ${P95_BUDGET_MS}ms (chegou a ${firstBreak.draw.p95}ms).`)
  } else {
    console.log(`✅ Nenhum estagio estourou ${P95_BUDGET_MS}ms no p95. Suba os estagios com LOADTEST_STAGES pra achar o teto.`)
  }
  console.log('Dica: rode o server sob `clinic doctor` no mesmo periodo pra correlacionar com o event-loop lag.')

  await sleep(500)
  process.exit(0)
}

main().catch(err => {
  console.error('[loadtest] fatal', err)
  process.exit(1)
})
