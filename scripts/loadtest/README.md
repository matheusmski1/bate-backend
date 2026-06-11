# Load test — Batinho

Harness de carga pro servidor Socket.io. Sobe N "salas" simultâneas, cada uma com 4 bots que **autenticam de verdade** (`/auth/guest` → cookie), criam a sala, entram e jogam rodadas em loop. Mede o round-trip dos eventos de jogo e acha onde o p95 estoura.

**Objetivo:** não é provar que escala — é **achar onde quebra primeiro**.

## Como funciona

- Cada bot pega sessão guest (cookie JWT) e abre 1 WebSocket.
- 1 sala = host (`room:create` + `room:join`) + 3 bots (`room:join`) → `game:start`.
- Os bots reagem ao `room:state`: no seu turno fazem `game:draw` → `game:keep-or-discard` (discard, `useEffect:false` pra manter o fluxo simples). Rodada acaba por deck vazio → host pede `game:next-round` até `match-end`.
- Métrica primária: **RTT do `game:draw`** (emit → ack). É o evento mais quente e reflete fila + lock + `setRoom` + broadcast sob carga.
- Rampa em estágios (10 → 50 → 100 → 200 salas por padrão), segura cada estágio por 30s, e reporta p50/p95/p99.

> ⚠️ **A carga vem do número de salas, não da velocidade do jogador.** O server limita `game:draw` a 1/s por socket (rate-limit anti-abuso). Por isso o bot joga em ritmo humano (`THINK_MS=500`) e o stress é gerado escalando salas. Baixar muito o `THINK_MS` só faz o bot bater no rate-limit (drop sem ack), não estressa o server. Pra medir o teto ABSOLUTO ignorando essa proteção, suba o limite em `src/server/rate-limit.ts` num branch de teste.

## Rodar

Em um terminal, sobe o server **sem DB e sem Redis** (MemoryStorage, 1 processo — baseline limpo):

```bash
pnpm dev          # porta 3001
```

Em outro terminal:

```bash
pnpm loadtest
```

### Apontar pra outro alvo / mexer no escopo

Tudo via env var:

| Var | Default | O que faz |
|---|---|---|
| `LOADTEST_URL` | `http://localhost:3001` | URL do backend |
| `LOADTEST_STAGES` | `10,50,100,200` | estágios (salas simultâneas) |
| `LOADTEST_HOLD_MS` | `30000` | quanto segura cada estágio |
| `LOADTEST_THINK_MS` | `500` | think-time do bot por turno (ritmo humano) |
| `LOADTEST_P95_BUDGET_MS` | `200` | budget de p95 pro "achou o gargalo" |
| `LOADTEST_RAMP_MS` | `3000` | espera antes de medir (deixa estabilizar) |

Exemplo — mirar mais alto e apertar:

```bash
LOADTEST_STAGES=50,150,300,500 LOADTEST_THINK_MS=120 pnpm loadtest
```

Smoke rápido (2 salas, 8s):

```bash
LOADTEST_STAGES=2 LOADTEST_HOLD_MS=8000 pnpm loadtest
```

## Ver o event-loop lag do server (clinic)

O harness mede o lado cliente (RTT). Pra ver o que o **server** sofre, roda ele sob o `clinic doctor` e dispara a carga em paralelo:

```bash
npx clinic doctor -- npx tsx src/server/index.ts
# (em outro terminal) pnpm loadtest
# Ctrl+C no server quando terminar → abre o relatório HTML com o event-loop delay
```

> Predição registrada: o primeiro gargalo provavelmente NÃO é nº de conexões, e sim **event-loop lag** vindo dos dois `setInterval` que varrem todas as rooms a cada 2s/30s + o `redact`/`JSON.stringify` por jogador a cada broadcast. O clinic confirma ou refuta isso.

## Testar o caminho de produção (Redis)

Pra medir o overhead do RedisStorage + adapter (o que roda em prod com réplicas):

```bash
REDIS_URL=redis://localhost:6379 pnpm dev
# e rodar o loadtest normalmente
```
