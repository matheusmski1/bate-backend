# Live Final Snap Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a sequência de bate fecha a rodada, abrir uma janela viva (`final-snap`) onde o corte ainda funciona; só finalizar (score + round-end) quando a janela fecha, estendendo a cada corte certo.

**Architecture:** Núcleo puro no engine (`openFinalSnapWindow` abre a janela sem score; `tallyRound` calcula score + fim no fechamento). Casca de IO (`final-snap.ts`) agenda o finalizador no servidor com registro de timer por sala e reagenda no corte. Substitui o mecanismo congelado do PR #15.

**Tech Stack:** TypeScript strict, socket.io, Vitest. Sem libs novas.

**Baseline:** branch `feat/final-snap-window` (em cima de `feat/round-end-reveal-pause`). O repo tem ~42 erros de `tsc` PRÉ-EXISTENTES em seeds/fixtures antigos — ao rodar `npx tsc --noEmit`, confirme que o total continua 42 e que nenhum novo erro cita os arquivos tocados. Não tente zerar os 42.

---

## File Structure

- `src/types/shared.ts` (+ espelho `bate-frontend/src/types/shared.ts`): `'final-snap'` em `GamePhase`.
- `src/server/game/engine.ts`: `tallyRound`, `openFinalSnapWindow`, `extendFinalSnapWindow` (puros); `advanceTurn`/`advanceTurnExported` chamam `openFinalSnapWindow`; `snapCard` aceita `final-snap`; const `FINAL_SNAP_WINDOW_MS`.
- `src/server/game/state.ts`: `isBoardPhase` inclui `final-snap`; remove `boardRevealSnapshot`/`planEndReveal`/`EndRevealPlan` (mantém `isEndPhase`/`isBoardPhase`).
- `src/server/handlers/final-snap.ts` (novo, substitui `end-reveal.ts`): registro de timer, `scheduleRoundFinalize`, `broadcastAfterAction`. Remove `end-reveal.ts`.
- `src/server/handlers/game-handlers.ts`: usa `broadcastAfterAction`; extensão no `game:snap`.
- Tests: reescreve `tests/server/game/end-reveal.test.ts`; novo `tests/server/handlers/final-snap.test.ts`; novo `tests/server/game/final-snap-engine.test.ts`; novo e2e `tests/e2e/final-snap.test.ts`; remove `tests/server/handlers/schedule-end-reveal.test.ts`.
- `bate-frontend/src/components/room2d/GameArea.tsx` + um banner de contagem.
- `bate-frontend/src/lib/changelog.ts`.

---

## Task 1: Adicionar a fase `final-snap`

**Files:**
- Modify: `src/types/shared.ts`, `bate-frontend/src/types/shared.ts`, `src/server/game/state.ts`
- Test: `tests/server/game/end-reveal.test.ts`

- [ ] **Step 1: Adicionar `'final-snap'` ao GamePhase (backend)**

In `src/types/shared.ts`, the `GamePhase` union has `| 'bate-called'` then `| 'round-end'`. Insert `final-snap` between them:

```typescript
  | 'bate-called'
  | 'final-snap'
  | 'round-end'
```

- [ ] **Step 2: Espelhar no frontend**

In `bate-frontend/src/types/shared.ts`, make the IDENTICAL edit to its `GamePhase` union (add `| 'final-snap'` after `| 'bate-called'`).

- [ ] **Step 3: `isBoardPhase` inclui `final-snap` (failing test first)**

In `tests/server/game/end-reveal.test.ts`, find the test `'classifica fases de fim e de tabuleiro'` and add this assertion inside it:

```typescript
    expect(isBoardPhase('final-snap')).toBe(true)
    expect(isEndPhase('final-snap')).toBe(false)
```

Run `npx vitest run tests/server/game/end-reveal.test.ts` → FAIL (isBoardPhase('final-snap') is false).

- [ ] **Step 4: Implement**

In `src/server/game/state.ts`, update `isBoardPhase`:

```typescript
export function isBoardPhase(phase: GamePhase): boolean {
  return phase === 'playing' || phase === 'bate-called' || phase === 'effect-pending' || phase === 'final-snap'
}
```

- [ ] **Step 5: Run tests**

`npx vitest run tests/server/game/end-reveal.test.ts` → PASS. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 42 (unchanged). In the frontend: `cd ../bate-frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0.

- [ ] **Step 6: Commit (both repos)**

```bash
cd /Users/matheusdev/projects/bate-backend
git add src/types/shared.ts src/server/game/state.ts tests/server/game/end-reveal.test.ts
git commit -m "feat: add final-snap game phase"
cd /Users/matheusdev/projects/bate-frontend
git add src/types/shared.ts
git commit -m "feat: mirror final-snap game phase"
```

Note: the frontend commit goes on whatever branch the frontend is on; create/checkout `feat/final-snap-window` off `origin/staging` in bate-frontend first: `git checkout -b feat/final-snap-window origin/staging` before Step 6's frontend commit.

---

## Task 2: `tallyRound` + `openFinalSnapWindow` + `extendFinalSnapWindow` (puros)

**Files:**
- Modify: `src/server/game/engine.ts`
- Test: `tests/server/game/final-snap-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/game/final-snap-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { tallyRound, openFinalSnapWindow, extendFinalSnapWindow } from '@/server/game/engine'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function bateState(overrides: Partial<GameState> = {}): GameState {
  const players: Player[] = [
    { id: 'p1', socketId: null, name: 'A', hand: [], score: 10, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    { id: 'p2', socketId: null, name: 'B', hand: [card('K'), card('5')], score: 20, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
  ]
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2, players, pendingJoins: [],
    deck: [], discard: [card('A', 'spades')], turn: 0, phase: 'bate-called',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null, snapWindow: null,
    log: [{ timestamp: 1, type: 'discard', actorId: 'p2' }],
    createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: 999, paused: false, pausedRemainingMs: null,
    roundTurnCount: 3, roundNumber: 1, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

describe('openFinalSnapWindow', () => {
  it('abre fase final-snap sem calcular score, com snapWindow no topo do descarte', () => {
    const next = openFinalSnapWindow(bateState(), 2500)
    expect(next.phase).toBe('final-snap')
    expect(next.players[1]!.score).toBe(20)
    expect(next.turnDeadlineAt).toBeNull()
    expect(next.snapWindow?.discardedCardId).toBe('A-spades')
    expect(next.snapWindow?.durationMs).toBe(2500)
  })
})

describe('tallyRound', () => {
  it('soma scoreHand das mãos atuais e vira round-end', () => {
    const next = tallyRound(openFinalSnapWindow(bateState(), 2500))
    expect(next.phase).toBe('round-end')
    expect(next.players[1]!.score).toBe(20 + 10 + 5)
    expect(next.snapWindow).toBeNull()
    expect(next.log[next.log.length - 1]!.type).toBe('round-end')
  })

  it('vira match-end se algum score >= 100', () => {
    const s = openFinalSnapWindow(bateState({ players: [
      { id: 'p1', socketId: null, name: 'A', hand: [], score: 99, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [card('K')], score: 20, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ] }), 2500)
    expect(tallyRound(s).phase).toBe('match-end')
  })
})

describe('extendFinalSnapWindow', () => {
  it('reinicia o snapWindow com a nova duração', () => {
    const opened = openFinalSnapWindow(bateState(), 2500)
    const extended = extendFinalSnapWindow(opened, 2000)
    expect(extended.snapWindow?.durationMs).toBe(2000)
    expect(extended.phase).toBe('final-snap')
  })
})
```

NOTE: confirm `card('A','spades')` produces a valid `Card['rank']` — 'A' and 'K'/'5' must be valid ranks (read `src/types/shared.ts` Card rank union). If `scoreHand` of K+5 differs from 15, adjust the expected `20 + <real values>` after reading `CARD_VALUES` in `src/server/game/scoring.ts`. Use the REAL values.

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run tests/server/game/final-snap-engine.test.ts` → functions not exported.

- [ ] **Step 3: Implement in `src/server/game/engine.ts`**

Near the top, after `const SNAP_WINDOW_MS = 3000`, add:

```typescript
const FINAL_SNAP_WINDOW_MS = Number(process.env.FINAL_SNAP_WINDOW_MS ?? 2500)
```

Add these exported functions (place them after `endRoundEmptyDeck`):

```typescript
export function tallyRound(state: GameState): GameState {
  const players = state.players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
  return {
    ...state,
    players,
    phase: isMatchEnd(players) ? 'match-end' : 'round-end',
    snapWindow: null,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    log: [...state.log, { timestamp: Date.now(), type: 'round-end', actorId: '', payload: { reason: 'bate' } }],
  }
}

export function openFinalSnapWindow(state: GameState, windowMs: number = FINAL_SNAP_WINDOW_MS): GameState {
  const top = state.discard[state.discard.length - 1]
  return {
    ...state,
    phase: 'final-snap',
    turnsRemaining: 0,
    turnDeadlineAt: null,
    paused: false,
    pausedRemainingMs: null,
    snapWindow: top ? { openedAt: Date.now(), durationMs: windowMs, discardedCardId: top.id } : null,
  }
}

export function extendFinalSnapWindow(state: GameState, extendMs: number): GameState {
  if (!state.snapWindow) return state
  return { ...state, snapWindow: { ...state.snapWindow, openedAt: Date.now(), durationMs: extendMs } }
}
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run tests/server/game/final-snap-engine.test.ts`.

- [ ] **Step 5: tsc** — `npx tsc --noEmit 2>&1 | grep -E "engine.ts|final-snap-engine" || echo CLEAN`.

- [ ] **Step 6: Commit**
```bash
git add src/server/game/engine.ts tests/server/game/final-snap-engine.test.ts
git commit -m "feat: add tallyRound and final snap window engine helpers"
```

---

## Task 3: Rewire `advanceTurn` / `advanceTurnExported` para abrir a janela

**Files:**
- Modify: `src/server/game/engine.ts`
- Test: `tests/server/game/final-snap-engine.test.ts` (append)

- [ ] **Step 1: Append a failing integration test**

Append to `tests/server/game/final-snap-engine.test.ts`:

```typescript
import { discardDrawnCard, callBate } from '@/server/game/engine'

describe('última ação do bate abre final-snap em vez de finalizar', () => {
  it('2 jogadores: descarte final do bate vira final-snap, não round-end', () => {
    const players: Player[] = [
      { id: 'p1', socketId: null, name: 'A', hand: [card('3')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [card('K'), card('K', 'clubs', 'K-clubs')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ]
    const base: GameState = {
      roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2, players, pendingJoins: [],
      deck: [card('9')], discard: [card('2')], turn: 0, phase: 'playing',
      bateCallerId: null, turnsRemaining: null, pendingEffect: null, snapWindow: null,
      log: [], createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
      roundTurnCount: 0, roundNumber: 1, roundStartedAt: 1, spectators: [],
    }
    const afterBate = callBate(base, 'p1')
    expect(afterBate.phase).toBe('bate-called')
    expect(afterBate.turnsRemaining).toBe(1)
    expect(afterBate.turn).toBe(1)
    const afterLast = discardDrawnCard(afterBate, 'p2', card('7'), false)
    expect(afterLast.phase).toBe('final-snap')
    expect(afterLast.players[1]!.score).toBe(0)
  })
})
```

This drives: p1 calls bate (turnsRemaining=1, turn→p2). p2 discards a drawn 7 (no effect) → `advanceTurn` decrements turnsRemaining to 0 → must open `final-snap` (NOT round-end, NOT scored yet).

- [ ] **Step 2: Run, verify FAIL** — currently `afterLast.phase` is `'round-end'`.

- [ ] **Step 3: Rewire both advance functions**

In `src/server/game/engine.ts`, the private `advanceTurn` currently is:

```typescript
function advanceTurn(state: GameState): GameState {
  const nextTurn = (state.turn + 1) % state.players.length
  let phase = state.phase
  let turnsRemaining = state.turnsRemaining
  let players = state.players
  if (state.phase === 'bate-called' && state.turnsRemaining !== null) {
    turnsRemaining = state.turnsRemaining - 1
    if (turnsRemaining <= 0) {
      players = state.players.map(p => ({ ...p, score: p.score + scoreHand(p.hand) }))
      phase = isMatchEnd(players) ? 'match-end' : 'round-end'
    }
  }
  return withFreshTurnTimer({ ...state, players, turn: nextTurn, phase, turnsRemaining, roundTurnCount: state.roundTurnCount + 1 })
}
```

Replace it with:

```typescript
function advanceTurn(state: GameState): GameState {
  const nextTurn = (state.turn + 1) % state.players.length
  if (state.phase === 'bate-called' && state.turnsRemaining !== null) {
    const turnsRemaining = state.turnsRemaining - 1
    if (turnsRemaining <= 0) {
      return openFinalSnapWindow({ ...state, turn: nextTurn, turnsRemaining: 0, roundTurnCount: state.roundTurnCount + 1 })
    }
    return withFreshTurnTimer({ ...state, turn: nextTurn, turnsRemaining, roundTurnCount: state.roundTurnCount + 1 })
  }
  return withFreshTurnTimer({ ...state, turn: nextTurn, roundTurnCount: state.roundTurnCount + 1 })
}
```

Apply the EXACT same transformation to `advanceTurnExported` (same body, different name). Its current body has the identical score/phase block — replace with the same `openFinalSnapWindow(...)` early return.

- [ ] **Step 4: Run the full suite**

`npx vitest run` → all pass. (No existing test asserts an action→round-end transition; if any fails because it expected immediate `round-end` from a bate-final action, update it to expect `final-snap` then `tallyRound(...)` → round-end, per the new behavior. Report any such test changed.)

- [ ] **Step 5: tsc** — total still 42, nothing new in engine.

- [ ] **Step 6: Commit**
```bash
git add src/server/game/engine.ts tests/server/game/final-snap-engine.test.ts
git commit -m "feat: open final snap window instead of finalizing on last bate action"
```

---

## Task 4: `snapCard` aceita `final-snap`

**Files:**
- Modify: `src/server/game/engine.ts`
- Test: `tests/server/game/final-snap-engine.test.ts` (append)

- [ ] **Step 1: Append failing test**

```typescript
import { snapCard } from '@/server/game/engine'

describe('snap na janela final', () => {
  it('corte de carta igual ao topo funciona em final-snap', () => {
    const s = openFinalSnapWindow({
      ...bateState(),
      players: [
        { id: 'p1', socketId: null, name: 'A', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
        { id: 'p2', socketId: null, name: 'B', hand: [card('A', 'clubs', 'A-clubs')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      ],
      discard: [card('A', 'spades')],
    }, 2500)
    const after = snapCard(s, 'p2', 0)
    expect(after.players[1]!.hand).toHaveLength(0)
    expect(after.log[after.log.length - 1]!.type).toBe('snap')
  })
})
```

- [ ] **Step 2: Run, verify FAIL** — `snapCard` throws `INVALID_PHASE` for `final-snap`.

- [ ] **Step 3: Implement** — in `snapCard`, change the phase guard:

```typescript
  if (state.phase !== 'playing' && state.phase !== 'bate-called' && state.phase !== 'final-snap') {
    throw new Error('INVALID_PHASE')
  }
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/server/game/engine.ts tests/server/game/final-snap-engine.test.ts
git commit -m "feat: allow snapping during final snap window"
```

---

## Task 5: Casca de IO `final-snap.ts` (substitui `end-reveal.ts`)

**Files:**
- Create: `src/server/handlers/final-snap.ts`
- Delete: `src/server/handlers/end-reveal.ts`, `tests/server/handlers/schedule-end-reveal.test.ts`
- Modify: `src/server/game/state.ts` (remove `boardRevealSnapshot`/`planEndReveal`/`EndRevealPlan`), `tests/server/game/end-reveal.test.ts` (remove their tests)
- Test: `tests/server/handlers/final-snap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/handlers/final-snap.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameState } from '@/types/shared'

const getRoom = vi.fn()
const setRoom = vi.fn()
vi.mock('@/server/lobby', () => ({ lobby: {
  getRoom: (...a: unknown[]) => getRoom(...a),
  setRoom: (...a: unknown[]) => setRoom(...a),
  withRoomLock: (_id: string, fn: () => unknown) => fn(),
} }))

import { scheduleRoundFinalize, broadcastAfterAction } from '@/server/handlers/final-snap'

type Emit = { socketId: string; event: string; payload: any }
function fakeIo(): { io: any; emits: Emit[] } {
  const emits: Emit[] = []
  const io = { to: (socketId: string) => ({ emit: (event: string, payload: any) => emits.push({ socketId, event, payload }) }) }
  return { io, emits }
}
function finalSnapState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2,
    players: [
      { id: 'p1', socketId: 's1', name: 'A', hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: 's2', name: 'B', hand: [{ id: 'K-h', rank: 'K', suit: 'hearts' }], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ],
    pendingJoins: [], deck: [], discard: [], turn: 0, phase: 'final-snap',
    bateCallerId: 'p1', turnsRemaining: 0, pendingEffect: null,
    snapWindow: { openedAt: 1, durationMs: 2500, discardedCardId: 'x' },
    log: [], createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
    roundTurnCount: 1, roundNumber: 1, roundStartedAt: 1, spectators: [],
    ...overrides,
  }
}

beforeEach(() => { vi.useFakeTimers(); getRoom.mockReset(); setRoom.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('broadcastAfterAction', () => {
  it('em final-snap faz broadcast e agenda o finalize', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    broadcastAfterAction(io, finalSnapState(), 50)
    expect(emits.length).toBe(2)
    expect(emits[0]!.payload.state.phase).toBe('final-snap')
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).toHaveBeenCalled()
    const persisted = setRoom.mock.calls[0]![0] as GameState
    expect(persisted.phase).toBe('round-end')
    expect(persisted.players[1]!.score).toBe(10)
  })
})

describe('scheduleRoundFinalize', () => {
  it('finaliza no deadline (tallyRound) e faz broadcast do round-end', async () => {
    const { io, emits } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).toHaveBeenCalled()
    expect(emits.some(e => e.payload.state.phase === 'round-end')).toBe(true)
  })

  it('ignora se a sala saiu de final-snap (guard)', async () => {
    const { io } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState({ phase: 'round-end' }))
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).not.toHaveBeenCalled()
  })

  it('reagendar limpa o timer anterior (só finaliza uma vez)', async () => {
    const { io } = fakeIo()
    getRoom.mockResolvedValue(finalSnapState())
    scheduleRoundFinalize(io, 'r1', 1, 50)
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).toHaveBeenCalledTimes(1)
  })

  it('ignora se a sala sumiu', async () => {
    const { io } = fakeIo()
    getRoom.mockResolvedValue(undefined)
    scheduleRoundFinalize(io, 'r1', 1, 50)
    await vi.advanceTimersByTimeAsync(50)
    expect(setRoom).not.toHaveBeenCalled()
  })
})
```

NOTE: `scoreHand` of a single `K` must equal 10 for `persisted.players[1].score === 10`; confirm against `CARD_VALUES` in `scoring.ts` and adjust the expected number if K's value differs.

- [ ] **Step 2: Run, verify FAIL** — module `@/server/handlers/final-snap` missing.

- [ ] **Step 3: Implement `src/server/handlers/final-snap.ts`**

```typescript
import type { Server as SocketServer } from 'socket.io'
import type { GameState } from '@/types/shared'
import { lobby } from '../lobby'
import { broadcastRoom } from './broadcast'
import { tallyRound } from '../game/engine'
import { log } from '../logger'

const FINAL_SNAP_WINDOW_MS = Number(process.env.FINAL_SNAP_WINDOW_MS ?? 2500)
const finalizeTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleRoundFinalize(
  io: SocketServer,
  roomId: string,
  expectedRoundNumber: number,
  delayMs: number = FINAL_SNAP_WINDOW_MS,
): void {
  const existing = finalizeTimers.get(roomId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    finalizeTimers.delete(roomId)
    void (async () => {
      await lobby.withRoomLock(roomId, async () => {
        const current = await lobby.getRoom(roomId)
        if (!current) return
        if (current.phase !== 'final-snap' || current.roundNumber !== expectedRoundNumber) return
        const ended = tallyRound(current)
        await lobby.setRoom(ended)
        broadcastRoom(io, ended)
      })
    })().catch(err => log.error('final-snap', 'finalize failed', { roomId, error: err instanceof Error ? err.message : 'UNKNOWN' }))
  }, delayMs)
  finalizeTimers.set(roomId, timer)
}

export function broadcastAfterAction(
  io: SocketServer,
  next: GameState,
  delayMs: number = FINAL_SNAP_WINDOW_MS,
): void {
  broadcastRoom(io, next)
  if (next.phase === 'final-snap') {
    scheduleRoundFinalize(io, next.roomId, next.roundNumber, delayMs)
  }
}
```

- [ ] **Step 4: Remove the superseded PR #15 code**

Delete `src/server/handlers/end-reveal.ts` and `tests/server/handlers/schedule-end-reveal.test.ts`:
```bash
git rm src/server/handlers/end-reveal.ts tests/server/handlers/schedule-end-reveal.test.ts
```
In `src/server/game/state.ts`, remove `boardRevealSnapshot`, `planEndReveal`, and the `EndRevealPlan` type (keep `isEndPhase` and `isBoardPhase`). In `tests/server/game/end-reveal.test.ts`, remove the `describe('boardRevealSnapshot', ...)` and `describe('planEndReveal', ...)` blocks and their imports/fixtures that only they use (keep the `isEndPhase / isBoardPhase` describe block). Rename the file to `tests/server/game/phase-predicates.test.ts` with `git mv` to reflect its reduced scope.

- [ ] **Step 5: Run suite + tsc**

`npx vitest run` → all pass. `npx tsc --noEmit 2>&1 | grep -E "final-snap|state.ts|game-handlers"` → no NEW errors (note: `game-handlers.ts` still imports `broadcastEndAware` from the now-deleted `end-reveal.ts` — that breaks compile until Task 6. To keep this task green, temporarily switch the import in `game-handlers.ts` to `import { broadcastAfterAction } from './final-snap'` and replace the 5 `broadcastEndAware(io, room.phase, next)` calls with `broadcastAfterAction(io, next)` now — Task 6 then refines the snap-extend case. If you do this here, run the full suite again.)

Pragmatic ordering: do the minimal game-handlers swap (broadcastEndAware → broadcastAfterAction, dropping the prevPhase arg) as part of THIS task so the project compiles, then Task 6 adds the snap-extend refinement.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat: replace frozen reveal pause with live final-snap IO shell"
```

---

## Task 6: Extensão da janela no `game:snap`

**Files:**
- Modify: `src/server/handlers/game-handlers.ts`, `src/server/handlers/final-snap.ts`

- [ ] **Step 1: Add `FINAL_SNAP_EXTEND_MS` + reschedule helper**

In `src/server/handlers/final-snap.ts`, add near the top:
```typescript
const FINAL_SNAP_EXTEND_MS = Number(process.env.FINAL_SNAP_EXTEND_MS ?? 2000)
```
Export a helper that re-broadcasts an extended state and reschedules:
```typescript
export function broadcastSnapExtend(io: SocketServer, next: GameState): void {
  broadcastRoom(io, next)
  scheduleRoundFinalize(io, next.roomId, next.roundNumber, FINAL_SNAP_EXTEND_MS)
}
```

- [ ] **Step 2: Wire the snap handler**

In `src/server/handlers/game-handlers.ts`, import `extendFinalSnapWindow` from the engine and `broadcastSnapExtend` from `./final-snap`. In the `game:snap` handler, after computing `const next = snapCard(room, payload.playerId, payload.handIndex)` and persisting, replace the broadcast logic with:

```typescript
        const lastType = next.log[next.log.length - 1]?.type
        if (room.phase === 'final-snap' && next.phase === 'final-snap' && lastType === 'snap') {
          const extended = extendFinalSnapWindow(next, Number(process.env.FINAL_SNAP_EXTEND_MS ?? 2000))
          await lobby.setRoom(extended)
          broadcastSnapExtend(io, extended)
        } else {
          broadcastAfterAction(io, next)
        }
```

(Replace the existing `broadcastRoom(io, next)` / `broadcastAfterAction(io, next)` line in that handler. The other 4 action handlers keep `broadcastAfterAction(io, next)` from Task 5.)

- [ ] **Step 3: Run suite + tsc** — all green; 42 baseline.

- [ ] **Step 4: Commit**
```bash
git add src/server/handlers/final-snap.ts src/server/handlers/game-handlers.ts
git commit -m "feat: extend final snap window on each successful snap"
```

---

## Task 7: Teste de regressão — efeito no último turno do bate

**Files:**
- Test: `tests/server/game/final-snap-engine.test.ts` (append)

- [ ] **Step 1: Append the test (must pass immediately — guards existing behavior)**

```typescript
import { swapAndDiscard } from '@/server/game/engine'

describe('efeito de carta no último turno do bate resolve antes de fechar', () => {
  it('descartar uma Q (swap) no último turno vai pra effect-pending, não fecha direto', () => {
    const players: Player[] = [
      { id: 'p1', socketId: null, name: 'A', hand: [card('3')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
      { id: 'p2', socketId: null, name: 'B', hand: [card('Q'), card('5')], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default' },
    ]
    const base: GameState = {
      roomId: 'r1', name: 'm', hostId: 'p1', maxPlayers: 2, players, pendingJoins: [],
      deck: [card('9')], discard: [card('2')], turn: 0, phase: 'playing',
      bateCallerId: null, turnsRemaining: null, pendingEffect: null, snapWindow: null,
      log: [], createdAt: 1, turnTimeLimitSec: 60, turnDeadlineAt: null, paused: false, pausedRemainingMs: null,
      roundTurnCount: 0, roundNumber: 1, roundStartedAt: 1, spectators: [],
    }
    const afterBate = callBate(base, 'p1')
    const afterSwap = swapAndDiscard(afterBate, 'p2', card('K'), 0)
    expect(afterSwap.phase).toBe('effect-pending')
    expect(afterSwap.pendingEffect?.type).toBe('swap')
  })
})
```

This proves the action-card effect is NOT cut off on the last bate turn (the round only closes after the effect resolves via `advanceTurnExported` → `final-snap`).

NOTE: confirm Q maps to the `swap` effect (per `effectFromRank` in engine.ts: Q→swap). If a different rank carries swap, use that rank.

- [ ] **Step 2: Run** — passes immediately. If it fails, that's a real bug to surface (report it).

- [ ] **Step 3: Commit**
```bash
git add tests/server/game/final-snap-engine.test.ts
git commit -m "test: guard action-card effect on last bate turn"
```

---

## Task 8: e2e — cenário dos 2 Áses

**Files:**
- Create: `tests/e2e/final-snap.test.ts`

- [ ] **Step 1: Write the e2e (gated by TEST_E2E)**

Create `tests/e2e/final-snap.test.ts` mirroring the structure of `tests/e2e/ghost-seat.test.ts` (same spawn/teardown/helpers). Use `PORT = 3099`, env `FINAL_SNAP_WINDOW_MS: '120'`, `FINAL_SNAP_EXTEND_MS: '120'`. The deterministic way to reach the scenario without controlling the shuffle is to seed the room state directly via the storage before connecting (the e2e server uses MemoryStorage when `REDIS_URL=''`). Since the e2e server is a separate process, you CANNOT inject storage directly; instead drive it through real sockets:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import { connect, guestSession, emitAck, waitForRoomState, waitForHealth } from './helpers'

const PORT = 3099
const BASE = `http://localhost:${PORT}`
const run = process.env.TEST_E2E ? describe : describe.skip

run('final-snap: janela viva de corte', () => {
  let server: ChildProcess
  beforeAll(async () => {
    const logFd = openSync('/tmp/e2e-final-snap.log', 'w')
    server = spawn('npx', ['tsx', 'src/server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'info', NODE_ENV: 'test', DATABASE_URL: '', REDIS_URL: '', FINAL_SNAP_WINDOW_MS: '150', FINAL_SNAP_EXTEND_MS: '150' },
      stdio: ['ignore', logFd, logFd], detached: true,
    })
    await waitForHealth(BASE)
  }, 40000)
  afterAll(() => { if (server?.pid) { try { process.kill(-server.pid, 'SIGKILL') } catch { /* gone */ } } })

  it('depois da última ação do bate, a fase fica final-snap antes de virar round-end', async () => {
    const host = await guestSession(BASE)
    const hostSocket = await connect(BASE, host.cookie)
    const created = await emitAck(hostSocket, 'room:create', { name: 'fs', hostId: host.playerId, hostName: 'Host', maxPlayers: 2, turnTimeLimitSec: 600 })
    const roomId = created.roomId as string
    await emitAck(hostSocket, 'room:join', { roomId, playerId: host.playerId, playerName: 'Host' })
    const guest = await guestSession(BASE)
    const guestSocket = await connect(BASE, guest.cookie)
    await emitAck(guestSocket, 'room:join', { roomId, playerId: guest.playerId, playerName: 'Guest' })
    await emitAck(hostSocket, 'game:start', { roomId, playerId: host.playerId })
    await emitAck(hostSocket, 'game:initial-peek-done', { roomId, playerId: host.playerId })
    await emitAck(guestSocket, 'game:initial-peek-done', { roomId, playerId: guest.playerId })

    const sawFinalSnap = waitForRoomState(guestSocket, s => s.phase === 'final-snap', 8000)
    const sawRoundEnd = waitForRoomState(guestSocket, s => s.phase === 'round-end', 8000)

    await playUntilBateCloses(hostSocket, guestSocket, roomId, host.playerId, guest.playerId)

    await expect(sawFinalSnap).resolves.toBeTruthy()
    await expect(sawRoundEnd).resolves.toBeTruthy()
  }, 30000)
})
```

Implement `playUntilBateCloses` as a helper INSIDE the test file that drives a real 2-player game to a bate close: each player on their turn does `game:draw` then `game:keep-or-discard` (action 'discard', useEffect false) reading the current `room:state` to know whose turn it is, and the first player to be able calls `game:bate` when allowed (hand empty path or explicit). Because the deck is random, the loop must be defensive: cap at ~40 actions, on each `room:state` for the active player emit draw→discard; when `bateCallerId` is null and a player's hand reaches 1 card, that player discards to empty and the engine auto-bates; continue until a `final-snap` then `round-end` is observed. If the cap is hit without reaching the close, FAIL with a clear message (do not silently pass).

This is the one non-deterministic part: keep it robust with the cap + clear failure. The assertions only require observing `final-snap` THEN `round-end`.

- [ ] **Step 2: Run** — `TEST_E2E=1 npx vitest run tests/e2e/final-snap.test.ts` → passes (observes final-snap then round-end). Iterate the `playUntilBateCloses` driver until stable.

- [ ] **Step 3: Commit**
```bash
git add tests/e2e/final-snap.test.ts
git commit -m "test: e2e final snap window appears before round end"
```

---

## Task 9: Frontend — habilitar corte em `final-snap` + contador

**Files:**
- Modify: `bate-frontend/src/components/room2d/GameArea.tsx`
- Create: `bate-frontend/src/components/room2d/FinalSnapBanner.tsx`

- [ ] **Step 1: Habilitar corte na fase final-snap**

In `GameArea.tsx`, line ~40, `isPlayPhase`:
```typescript
  const isPlayPhase = state.phase === 'playing' || state.phase === 'bate-called' || state.phase === 'final-snap'
```
And `canSnap` (line ~212) currently `isPlayPhase && state.discard.length > 0 && (!isMyTurn || !!drawnCard)`. In `final-snap` there is no active turn, so snapping must be free for everyone. Change to:
```typescript
  const canSnap = state.discard.length > 0 && (state.phase === 'final-snap' || (isPlayPhase && (!isMyTurn || !!drawnCard)))
```

- [ ] **Step 2: Countdown banner**

Create `bate-frontend/src/components/room2d/FinalSnapBanner.tsx`:
```typescript
'use client'
import { useEffect, useState } from 'react'
import type { RedactedState } from '@/types/shared'

export function FinalSnapBanner({ state }: { state: RedactedState }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [])
  if (state.phase !== 'final-snap' || !state.snapWindow) return null
  const remaining = Math.max(0, state.snapWindow.openedAt + state.snapWindow.durationMs - now)
  const secs = (remaining / 1000).toFixed(1)
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-bate-red text-bate-paper text-center py-1.5 text-xs sm:text-sm font-display tracking-wider shadow-hard-sm">
      ⚡ ÚLTIMO CORTE! {secs}s
    </div>
  )
}
```
Confirm `RedactedState` exposes `snapWindow` (it should, via the `...rest` spread in `redactStateForPlayer`; if `snapWindow` is omitted from `RedactedState`, add it to that type in `bate-frontend/src/types/shared.ts` and `bate-backend/src/types/shared.ts`).

- [ ] **Step 3: Render the banner**

In `GameArea.tsx`, import `FinalSnapBanner` and render `<FinalSnapBanner state={state} />` near the top of the returned JSX (alongside other fixed chrome).

- [ ] **Step 4: tsc** — `cd bate-frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"` → 0.

- [ ] **Step 5: Commit (frontend repo)**
```bash
cd /Users/matheusdev/projects/bate-frontend
git add src/components/room2d/GameArea.tsx src/components/room2d/FinalSnapBanner.tsx
git commit -m "feat: enable snapping and countdown during final snap window"
```

---

## Task 10: Changelog + verificação manual

**Files:**
- Modify: `bate-frontend/src/lib/changelog.ts`

- [ ] **Step 1: Changelog**

In `bate-frontend/src/lib/changelog.ts`, add to the most recent dated entry's `items`:
```typescript
      'Bateu? Agora dá pra cortar nos segundos finais antes de fechar a rodada — corre que dá tempo',
```
`npx tsc --noEmit` → 0. Commit:
```bash
git add src/lib/changelog.ts
git commit -m "docs: changelog entry for live final snap window"
```

- [ ] **Step 2: Verificação manual (humana)**

Subir back+front local com `FINAL_SNAP_WINDOW_MS=2500`. Dois jogadores; jogar até o bate fechar a rodada. Confirmar: depois da última ação, o tabuleiro continua vivo com o banner "ÚLTIMO CORTE!", dá pra cortar carta igual ao topo, e o score final reflete os cortes feitos na janela. Se algo não bater, abrir caso de debug (não marcar pronto).

---

## Self-Review (preenchido)

- **Cobertura do spec:** fase `final-snap` (T1) ✓; `tallyRound`+`openFinalSnapWindow`+`extendFinalSnapWindow` (T2) ✓; rewire advance→janela (T3) ✓; snap em final-snap (T4) ✓; casca IO + remoção do PR #15 (T5) ✓; extensão por corte (T6) ✓; regressão de efeito (T7) ✓; e2e cenário 2 Áses (T8) ✓; frontend corte+contador (T9) ✓; changelog+manual (T10) ✓. Config `FINAL_SNAP_WINDOW_MS`/`FINAL_SNAP_EXTEND_MS` ✓. Redação: `final-snap` não está no `revealAll` de `redact.ts` → mãos escondidas ✓ (nenhuma mudança necessária; confirmar no T5).
- **Escopo deck-vazio:** mantido fora (T2/T3 só mexem no path do bate; `endRoundEmptyDeck` intacto) — consistente com o spec.
- **Placeholders:** o único ponto não-determinístico (driver do e2e em T8) está explicitado com cap + falha clara, sem corte silencioso.
- **Consistência de tipos:** `tallyRound(state)`, `openFinalSnapWindow(state, windowMs?)`, `extendFinalSnapWindow(state, extendMs)`, `scheduleRoundFinalize(io, roomId, expectedRoundNumber, delayMs?)`, `broadcastAfterAction(io, next, delayMs?)`, `broadcastSnapExtend(io, next)` — assinaturas batem entre tasks. Fase `'final-snap'` usada igual em back/front. `snapWindow` type `{openedAt, durationMs, discardedCardId}` reusado.
- **Nota:** Task 5 antecipa o swap mínimo em `game-handlers.ts` pra manter o build compilando após remover `end-reveal.ts`; Task 6 refina o caso do snap. Documentado no passo.
