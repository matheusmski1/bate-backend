# Task 11 Report — e2e: practice room reaches round-end

## Status: COMPLETE (all checks pass)

## Files Changed
- `src/server/game/bot/driver.ts` — added `BOT_THINK_MS_OVERRIDE` env knob at top of `pickThinkMs`; added `scheduleRoundFinalize` import + call after bot turn transitions to `final-snap`
- `src/server/index.ts` — made `TURN_TIMER_INTERVAL_MS` env-overridable (`TURN_TIMER_INTERVAL_MS_OVERRIDE`); imported `scheduleRoundFinalize` and called it after turn-timer auto-action produces `final-snap`
- `tests/e2e/bot-treino.test.ts` — created the self-skipping e2e test (new file)

## pnpm test:e2e output

```
$ TEST_E2E=1 vitest run tests/e2e

 RUN  v4.1.7 /Users/matheusdev/projects/bate-backend

 Test Files  4 passed (4)
      Tests  6 passed (6)
   Start at  09:13:36
   Duration  24.14s (transform 82ms, setup 0ms, import 312ms, tests 31.80s, environment 0ms)
```

## Normal vitest run (self-skip)

```
$ npx vitest run tests/e2e/bot-treino.test.ts
PASS (0) FAIL (0) skipped (1)
```

## tsc result

`npx tsc --noEmit` → TypeScript: No errors found

## Integration Bugs Found and Fixed

### Bug 1: `final-snap` never finalized when entered via bot-driver or turn-timer path

**Root cause:** `scheduleRoundFinalize` was only called from `broadcastAfterAction` (in the `game:snap` handler). When the game entered `final-snap` via:
1. The turn-timer's `autoPlayExpiredTurn` → `broadcastRoom` path
2. The bot driver's `runBotTurn` → `broadcastRoom` path

...`scheduleRoundFinalize` was never called, leaving the game stuck in `final-snap` indefinitely.

**Fix:** Added `scheduleRoundFinalize(io, next.roomId, next.roundNumber)` in `index.ts` turn-timer and in `driver.ts` after bot turns that result in `final-snap`. The circular import (`driver.ts` → `final-snap.ts` → `broadcast.ts` → `driver.ts`) is safe in Node ESM because all references are inside function bodies, not at module initialization time.

### Bug 2: Human turns never auto-advanced quickly enough

**Root cause:** Practice rooms default to `turnTimeLimitSec: 60` and `TURN_TIMER_INTERVAL_MS = 2000`. The 30-second test timeout expired before enough human turns auto-completed.

**Fix:** Test passes `turnTimeLimitSec: 1` in the `room:create-practice` payload and sets `TURN_TIMER_INTERVAL_MS_OVERRIDE: '100'` in the spawned server's env. Both overrides are test-env only.

## Final-review fix wave

### Fix 1 — arm round-finalize on bot SNAP branch (driver.ts)
Added `if (next.phase === 'final-snap') scheduleRoundFinalize(io, roomId, next.roundNumber)` immediately after `broadcastRoom(io, next)` in the `action.kind === 'snap'` branch of `scheduleBotActions`. Reuses the existing `scheduleRoundFinalize` import (already present for the turn branch). Without this, a snap that transitions to `final-snap` would leave the round stuck indefinitely.

### Fix 2 — remove dead `rng` param from `runBotTurn` (index.ts + two test files)
Removed `rng: () => number = Math.random` from `runBotTurn`'s signature — the parameter was never referenced in the function body. Updated callers in `tests/server/game/bot/index.test.ts` (one call) and `tests/server/game/bot/integration.test.ts` (one call) to drop the trailing rng argument. The driver's call site was already clean. `planBotAction` and `decideSnap` rng usage untouched.

### Fix 3 — remove redundant `scheduleBotActions` call in practice handler (lobby-handlers.ts)
Removed the explicit `scheduleBotActions(io, started)` line after `broadcastRoom(io, started)` in the `room:create-practice` handler — `broadcastRoom` already calls `scheduleBotActions` for rooms with bots (broadcast.ts line 30). Removed the now-unused `scheduleBotActions` import from lobby-handlers.ts.

### Fix 4 — remove unused `vi` import (tests/server/handlers/practice.test.ts)
Removed `vi` from the `import { describe, it, expect, beforeEach, vi } from 'vitest'` line. It was never used in the file.

### Verify output
- `npx tsc --noEmit` → TypeScript: No errors found
- `npx vitest run` → PASS (167) FAIL (0) skipped (6) — same green as before; e2e self-skipped

## Concerns

- The circular ESM import (`driver.ts` → `final-snap.ts` → `broadcast.ts` → `driver.ts`) works under tsx/Node ESM but would not be safe in CommonJS. Consider refactoring to break the cycle: extract `scheduleRoundFinalize` into a standalone module that takes a generic broadcast callback.
- The `TURN_TIMER_INTERVAL_MS_OVERRIDE` and `turnTimeLimitSec: 1` are required to complete the round within 30 seconds. Without them, human turns take 60 s each and the test would need a much longer timeout.
