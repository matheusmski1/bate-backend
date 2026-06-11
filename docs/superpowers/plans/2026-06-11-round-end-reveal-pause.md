# Round-End Reveal Pause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando uma ação de jogador encerra a rodada (bate na última jogada, deck-vazio, fim de partida), o servidor mostra a jogada no tabuleiro por ~2.5s antes de mandar o estado de fim, pra todos verem o que aconteceu.

**Architecture:** Núcleo puro + casca fina. Um helper puro deriva o "snapshot de tabuleiro" a partir do estado de fim; uma função pura decide se a transição merece a pausa; uma casca de IO faz dois broadcasts (snapshot agora, estado de fim depois via `setTimeout`). Fonte da verdade no storage é sempre o estado de fim.

**Tech Stack:** TypeScript strict, socket.io, Vitest. Sem libs novas.

---

## File Structure

- `src/server/game/state.ts` — adiciona `isEndPhase`, `isBoardPhase`, `boardRevealSnapshot` (puro), `planEndReveal` (puro).
- `src/server/handlers/end-reveal.ts` — **novo**: `scheduleEndReveal` e `broadcastEndAware` (casca de IO + timer). Importa `broadcastRoom` de `./broadcast` (sentido único, sem ciclo).
- `src/server/handlers/game-handlers.ts` — troca `broadcastRoom(io, next)` → `broadcastEndAware(io, room.phase, next)` nos 5 handlers de ação que podem encerrar a rodada.
- `tests/server/game/end-reveal.test.ts` — **novo**: unit puro de `boardRevealSnapshot` + `planEndReveal`.
- `tests/server/handlers/schedule-end-reveal.test.ts` — **novo**: unit de `scheduleEndReveal` com fake timers + lobby mockado + io double.
- `src/lib/changelog.ts` (bate-frontend) — entrada de changelog (Task 6, repo do front).

**Nota de baseline:** esta branch saiu de `staging`, que ainda tem 42 erros de `tsc` pré-existentes (seeds + fixtures) até o PR de CI (#14) entrar. Ao rodar `npx tsc --noEmit`, confirme que o total continua **42** e que **nenhum** novo erro está nos arquivos tocados aqui — não tente zerar os 42.

---

## Task 1: Helper puro `boardRevealSnapshot` + predicados de fase

**Files:**
- Modify: `src/server/game/state.ts`
- Test: `tests/server/game/end-reveal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/game/end-reveal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { boardRevealSnapshot, isEndPhase, isBoardPhase } from '@/server/game/state'
import type { GameState } from '@/types/shared'

function endState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [
      { id: 'p1', socketId: null, name: 'A', hand: [], score: 5, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [], score: 9, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ],
    pendingJoins: [], deck: [], discard: [], turn: 0, phase: 'round-end',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null, snapWindow: null,
    log: [
      { timestamp: 1, type: 'discard', actorId: 'p1' },
      { timestamp: 2, type: 'round-end', actorId: '', payload: { reason: 'deck-empty' } },
    ],
    createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: 123456, paused: false, pausedRemainingMs: null,
    roundTurnCount: 4, roundNumber: 2, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

describe('isEndPhase / isBoardPhase', () => {
  it('classifica fases de fim e de tabuleiro', () => {
    expect(isEndPhase('round-end')).toBe(true)
    expect(isEndPhase('match-end')).toBe(true)
    expect(isEndPhase('playing')).toBe(false)
    expect(isBoardPhase('playing')).toBe(true)
    expect(isBoardPhase('bate-called')).toBe(true)
    expect(isBoardPhase('effect-pending')).toBe(true)
    expect(isBoardPhase('waiting')).toBe(false)
    expect(isBoardPhase('round-end')).toBe(false)
  })
})

describe('boardRevealSnapshot', () => {
  it('volta a fase pro tabuleiro, zera o timer e mantém o resto', () => {
    const snap = boardRevealSnapshot(endState(), 'bate-called')
    expect(snap.phase).toBe('bate-called')
    expect(snap.turnDeadlineAt).toBeNull()
    expect(snap.players[1].score).toBe(9)
    expect(snap.roundNumber).toBe(2)
  })

  it('remove a entrada de log round-end do final pra não disparar som de vitória cedo', () => {
    const snap = boardRevealSnapshot(endState(), 'playing')
    expect(snap.log).toHaveLength(1)
    expect(snap.log[snap.log.length - 1].type).toBe('discard')
  })

  it('não mexe no log quando a última entrada não é round-end (caso bate)', () => {
    const noEndLog = endState({ log: [{ timestamp: 1, type: 'discard', actorId: 'p2' }] })
    const snap = boardRevealSnapshot(noEndLog, 'bate-called')
    expect(snap.log).toHaveLength(1)
    expect(snap.log[0].type).toBe('discard')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/game/end-reveal.test.ts`
Expected: FAIL — `boardRevealSnapshot`/`isEndPhase`/`isBoardPhase` não existem (import error).

- [ ] **Step 3: Write minimal implementation**

In `src/server/game/state.ts`, after the `trimLog` function (top of file), add:

```typescript
import type { GamePhase } from '@/types/shared'

export function isEndPhase(phase: GamePhase): boolean {
  return phase === 'round-end' || phase === 'match-end'
}

export function isBoardPhase(phase: GamePhase): boolean {
  return phase === 'playing' || phase === 'bate-called' || phase === 'effect-pending'
}

export function boardRevealSnapshot(endState: GameState, prevPhase: GamePhase): GameState {
  const last = endState.log[endState.log.length - 1]
  const log = last && last.type === 'round-end' ? endState.log.slice(0, -1) : endState.log
  return { ...endState, phase: prevPhase, turnDeadlineAt: null, log }
}
```

Note: `GamePhase` may already be importable; if `state.ts` already imports from `@/types/shared`, add `GamePhase` to the existing import instead of a new line. Current import is `import type { GameState, GameAction, Player } from '@/types/shared'` — change it to `import type { GameState, GameAction, Player, GamePhase } from '@/types/shared'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/game/end-reveal.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/game/state.ts tests/server/game/end-reveal.test.ts
git commit -m "feat: add boardRevealSnapshot and phase predicates"
```

---

## Task 2: Decisão pura `planEndReveal`

**Files:**
- Modify: `src/server/game/state.ts`
- Test: `tests/server/game/end-reveal.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/server/game/end-reveal.test.ts`:

```typescript
import { planEndReveal } from '@/server/game/state'

describe('planEndReveal', () => {
  it('revela quando ação de tabuleiro vira fim de rodada', () => {
    const plan = planEndReveal('bate-called', endState({ phase: 'round-end' }))
    expect(plan.reveal).toBe(true)
    if (plan.reveal) expect(plan.snapshot.phase).toBe('bate-called')
  })

  it('revela quando ação de tabuleiro vira fim de partida', () => {
    const plan = planEndReveal('playing', endState({ phase: 'match-end' }))
    expect(plan.reveal).toBe(true)
  })

  it('não revela quando o estado seguinte ainda é de tabuleiro', () => {
    expect(planEndReveal('playing', endState({ phase: 'playing' })).reveal).toBe(false)
  })

  it('não revela quando já vinha de fase de fim (ex.: next-round)', () => {
    expect(planEndReveal('round-end', endState({ phase: 'match-end' })).reveal).toBe(false)
  })

  it('não revela a partir de waiting/initial-peek', () => {
    expect(planEndReveal('waiting', endState({ phase: 'round-end' })).reveal).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/game/end-reveal.test.ts`
Expected: FAIL — `planEndReveal` não existe.

- [ ] **Step 3: Write minimal implementation**

In `src/server/game/state.ts`, after `boardRevealSnapshot`, add:

```typescript
export type EndRevealPlan =
  | { reveal: false }
  | { reveal: true; snapshot: GameState }

export function planEndReveal(prevPhase: GamePhase, next: GameState): EndRevealPlan {
  if (isBoardPhase(prevPhase) && isEndPhase(next.phase)) {
    return { reveal: true, snapshot: boardRevealSnapshot(next, prevPhase) }
  }
  return { reveal: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/game/end-reveal.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/server/game/state.ts tests/server/game/end-reveal.test.ts
git commit -m "feat: add planEndReveal pure decision for round-end pause"
```

---

## Task 3: Casca de IO `scheduleEndReveal` + `broadcastEndAware`

**Files:**
- Create: `src/server/handlers/end-reveal.ts`
- Test: `tests/server/handlers/schedule-end-reveal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/handlers/schedule-end-reveal.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameState } from '@/types/shared'

const getRoom = vi.fn()
vi.mock('@/server/lobby', () => ({ lobby: { getRoom: (...a: unknown[]) => getRoom(...a) } }))

import { scheduleEndReveal, broadcastEndAware } from '@/server/handlers/end-reveal'

type Emit = { socketId: string; event: string; payload: any }

function fakeIo(): { io: any; emits: Emit[] } {
  const emits: Emit[] = []
  const io = { to: (socketId: string) => ({ emit: (event: string, payload: any) => emits.push({ socketId, event, payload }) }) }
  return { io, emits }
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [
      { id: 'p1', socketId: 's1', name: 'A', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: 's2', name: 'B', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ],
    pendingJoins: [], deck: [], discard: [], turn: 0, phase: 'round-end',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null, snapWindow: null,
    log: [{ timestamp: 1, type: 'discard', actorId: 'p1' }],
    createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
    roundTurnCount: 1, roundNumber: 1, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

beforeEach(() => { vi.useFakeTimers(); getRoom.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('broadcastEndAware', () => {
  it('em transição de tabuleiro→fim, manda primeiro o snapshot de tabuleiro', () => {
    const { io, emits } = fakeIo()
    broadcastEndAware(io, 'bate-called', state({ phase: 'round-end' }), 2500)
    const phases = emits.map(e => e.payload.state.phase)
    expect(phases.every(p => p === 'bate-called')).toBe(true)
    expect(emits.length).toBe(2)
  })

  it('sem transição de fim, manda o estado direto (comportamento atual)', () => {
    const { io, emits } = fakeIo()
    broadcastEndAware(io, 'playing', state({ phase: 'playing' }), 2500)
    expect(emits.every(e => e.payload.state.phase === 'playing')).toBe(true)
  })
})

describe('scheduleEndReveal', () => {
  it('re-transmite o estado de fim depois do delay quando fase/round batem', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(state({ phase: 'round-end', roundNumber: 1 }))
    scheduleEndReveal(io, 'r1', 'round-end', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(emits.length).toBe(2)
    expect(emits[0].payload.state.phase).toBe('round-end')
  })

  it('não transmite se a sala sumiu', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(undefined)
    scheduleEndReveal(io, 'r1', 'round-end', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(emits.length).toBe(0)
  })

  it('não transmite se a rodada já avançou (guard)', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(state({ phase: 'playing', roundNumber: 2 }))
    scheduleEndReveal(io, 'r1', 'round-end', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(emits.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/handlers/schedule-end-reveal.test.ts`
Expected: FAIL — `@/server/handlers/end-reveal` não existe.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/handlers/end-reveal.ts`:

```typescript
import type { Server as SocketServer } from 'socket.io'
import type { GamePhase, GameState } from '@/types/shared'
import { lobby } from '../lobby'
import { broadcastRoom } from './broadcast'
import { planEndReveal } from '../game/state'

const DEFAULT_REVEAL_MS = Number(process.env.ROUND_END_REVEAL_MS ?? 2500)

export function scheduleEndReveal(
  io: SocketServer,
  roomId: string,
  expectedPhase: GamePhase,
  expectedRoundNumber: number,
  delayMs: number = DEFAULT_REVEAL_MS,
): void {
  setTimeout(async () => {
    const current = await lobby.getRoom(roomId)
    if (!current) return
    if (current.phase !== expectedPhase || current.roundNumber !== expectedRoundNumber) return
    broadcastRoom(io, current)
  }, delayMs)
}

export function broadcastEndAware(
  io: SocketServer,
  prevPhase: GamePhase,
  next: GameState,
  delayMs: number = DEFAULT_REVEAL_MS,
): void {
  const plan = planEndReveal(prevPhase, next)
  if (!plan.reveal) {
    broadcastRoom(io, next)
    return
  }
  broadcastRoom(io, plan.snapshot)
  scheduleEndReveal(io, next.roomId, next.phase, next.roundNumber, delayMs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/handlers/schedule-end-reveal.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/handlers/end-reveal.ts tests/server/handlers/schedule-end-reveal.test.ts
git commit -m "feat: add broadcastEndAware and scheduleEndReveal IO shell"
```

---

## Task 4: Ligar nos handlers de ação

**Files:**
- Modify: `src/server/handlers/game-handlers.ts`

Troca cirúrgica: nos 5 handlers de ação que podem encerrar a rodada, captura `room.phase` ANTES da ação e usa `broadcastEndAware`. Os demais (`game:start`, `game:initial-peek-done`, `game:bate`, `game:next-round`) continuam com `broadcastRoom`.

- [ ] **Step 1: Atualizar o import**

In `src/server/handlers/game-handlers.ts:10`, replace:

```typescript
import { broadcastRoom } from './broadcast'
```

with:

```typescript
import { broadcastRoom } from './broadcast'
import { broadcastEndAware } from './end-reveal'
```

- [ ] **Step 2: `game:draw` (deck-vazio encerra)**

In the `game:draw` handler (~line 100-111), the pre-action room is `room`. Replace `broadcastRoom(io, next)` (line ~111) with:

```typescript
        broadcastEndAware(io, room.phase, next)
```

- [ ] **Step 3: `game:keep-or-discard` (bate na última jogada)**

In the `game:keep-or-discard` handler (~line 122-138), replace `broadcastRoom(io, next)` (line ~137) with:

```typescript
        broadcastEndAware(io, room.phase, next)
```

- [ ] **Step 4: `game:snap`**

In the `game:snap` handler (~line 148-156), replace `broadcastRoom(io, next)` (line ~154) with:

```typescript
        broadcastEndAware(io, room.phase, next)
```

- [ ] **Step 5: `game:skip-effect`**

In the `game:skip-effect` handler (~line 166-172), replace `broadcastRoom(io, next)` (line ~171) with:

```typescript
        broadcastEndAware(io, room.phase, next)
```

- [ ] **Step 6: `game:effect-target`**

In the `game:effect-target` handler (~line 181-187), replace `broadcastRoom(io, next)` (line ~186) with:

```typescript
        broadcastEndAware(io, room.phase, next)
```

- [ ] **Step 7: Verificar tipos e suíte**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `42` (baseline pré-existente inalterado — ver nota de baseline; confirme que nenhum erro novo cita `game-handlers.ts`, `end-reveal.ts` ou `state.ts` com `npx tsc --noEmit 2>&1 | grep -E "game-handlers|end-reveal|game/state"` → vazio).

Run: `npx vitest run`
Expected: todos passam (suíte atual + os novos testes das Tasks 1-3).

- [ ] **Step 8: Commit**

```bash
git add src/server/handlers/game-handlers.ts
git commit -m "feat: pause on board action that ends the round before broadcasting end state"
```

---

## Task 5: Verificação manual no app

**Files:** nenhum (verificação)

- [ ] **Step 1: Subir back + front local e jogar um 2-jogadores até o bate**

Com dois navegadores (ou aba normal + anônima), entre na mesma sala, comece a partida e jogue até alguém bater na última carta. Configure `ROUND_END_REVEAL_MS=2500` (default) no back.

Esperado: o jogador que NÃO bateu vê a última carta cair/animar no tabuleiro por ~2.5s e só então a tela de fim de rodada aparece. O som de vitória toca junto com a tela de fim, não antes.

- [ ] **Step 2: Anotar resultado**

Se o comportamento bater, seguir. Se não, abrir caso de debug (não marcar a feature como pronta).

---

## Task 6: Entrada no changelog (repo bate-frontend)

**Files:**
- Modify: `bate-frontend/src/lib/changelog.ts`

- [ ] **Step 1: Adicionar item na entrada do dia**

In `bate-frontend/src/lib/changelog.ts`, add to the most recent dated entry's `items` array (or create a `2026-06-11` entry if none for today after rebase):

```typescript
      'O bate agora dá um tempinho pra todo mundo ver a última jogada antes do fim da rodada',
```

- [ ] **Step 2: Verificar tipos**

Run (no diretório do front): `npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/changelog.ts
git commit -m "docs: add changelog entry for round-end reveal pause"
```

---

## Self-Review (preenchido)

- **Cobertura do spec:** snapshot de tabuleiro (Task 1) ✓; decisão de quando pausar (Task 2) ✓; 2 broadcasts + timer + guards (Task 3) ✓; ligação nos handlers de ação com escopo correto (Task 4) ✓; env `ROUND_END_REVEAL_MS` (Task 3, `DEFAULT_REVEAL_MS`) ✓; config default 2500 ✓; changelog (Task 6) ✓.
- **Desvio do spec (testes):** o spec previa um e2e dirigindo um bate real; trocado por unit puro (`planEndReveal`/`boardRevealSnapshot`) + unit do agendador com fake timers, porque dirigir um bate real depende do shuffle do deck e seria flaky. A lógica fica 100% coberta; a ligação fina nos handlers é verificada pela suíte existente + verificação manual (Task 5). Trade-off registrado aqui de propósito (sem corte silencioso).
- **Placeholders:** nenhum — todo passo tem código real.
- **Consistência de tipos:** `boardRevealSnapshot(endState, prevPhase)`, `planEndReveal(prevPhase, next): EndRevealPlan`, `broadcastEndAware(io, prevPhase, next, delayMs?)`, `scheduleEndReveal(io, roomId, expectedPhase, expectedRoundNumber, delayMs?)` — assinaturas batem entre tasks. `isEndPhase`/`isBoardPhase` consistentes.
