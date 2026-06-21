# Modo Treino vs Bots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-player "modo treino" where one human plays against 1–3 server-driven bots (Fácil/Médio/Difícil) using the existing pure engine.

**Architecture:** Bots are virtual `Player`s (`socketId: null`, `isBot: true`) in a real room. A pure bot brain (`game/bot/*`) decides moves from a **redacted, anti-cheat view** built from a per-bot `BotMemory`. A `driver` schedules one bot action per tick via `setTimeout` (thinking delay), executes it by calling the same engine functions the human handlers call, persists, and broadcasts. The existing turn-timer loop is the stall backstop.

**Tech Stack:** TypeScript strict (ESM), Socket.io, Vitest 4 (`globals: false`), Zustand + Next.js 15 (frontend), Redis/Memory storage abstraction.

## Global Constraints

- **TypeScript strict** + `noUncheckedIndexedAccess` + `noImplicitOverride`. New code must add **zero** new `tsc --noEmit` errors. Current baseline on `feat/bot-treino` is **0 errors** (the "42 errors" in the batinho-qa skill is stale — ignore it).
- **No code comments** (self-explanatory naming). **Test descriptions in Portuguese-BR.**
- **Vitest `globals: false`** → every test file must `import { describe, it, expect, vi, ... } from 'vitest'`. Import source via the `@` alias (`@/server/...`, `@/types/shared`).
- **No lint/build script in bate-backend** — the only static gate is `npx tsc --noEmit`. Frontend gate is `pnpm -C bate-frontend tsc --noEmit` and `pnpm -C bate-frontend build`.
- **Two-repo shared-type sync:** `src/types/shared.ts` is byte-identical in `bate-backend` and `bate-frontend`. Any edit must be applied verbatim to both.
- **Card values (`scoring.ts`):** `A=1 … 10=10, J=11, Q=12, K=-3, JOKER=-6`. K and JOKER are the **best** cards. Deck = **108 cards** (8 of each A..K, 4 JOKER). Expected value of an unknown card = `576/108 ≈ 5.333`.
- **`BotMemory` must be JSON-safe (arrays, no `Set`)** — `RedisStorage` persists via `JSON.stringify`, and `JSON.stringify(new Set())` is `{}` (silent data loss).
- **Lock discipline:** `scheduleBotActions` MUST only register a `setTimeout` and acquire `withRoomLock` **inside** the timer callback — `broadcastRoom` is called from inside `withRoomLock` blocks, and `MemoryStorage.withRoomLock` is non-reentrant (synchronous re-lock = deadlock). Redis `LOCK_TTL_MS = 5000ms`: the "thinking" delay runs OUTSIDE the lock; only the fast engine call runs inside it.
- **Practice rooms are `private: true`** (excluded from `listRooms()`), and **auto-start** (the handler calls `startRound` directly; it does not go through `game:start`).
- **Bots never receive a socket broadcast** (`broadcastRoom` skips `socketId === null`). They are driven only by the `driver`.

---

## Shared Interfaces (locked — every task uses these exact names/types)

```ts
// src/types/shared.ts (BOTH repos)
export type BotLevel = 'easy' | 'medium' | 'hard'
// Player gains: isBot?: boolean; botLevel?: BotLevel

// src/server/game/bot/config.ts
export const UNKNOWN_CARD_EV: number            // 576/108 ≈ 5.333, derived from CARD_VALUES
export type LevelConfig = {
  considerUnknownSwap: boolean
  useEffects: boolean
  snapAccuracy: number
  bateThreshold: number
  memoryTurns: number          // Infinity = never forget
  seedInitialCount: 1 | 2
  thinkMs: [number, number]
}
export const LEVEL_CONFIG: Record<BotLevel, LevelConfig>

// src/server/game/bot/belief.ts
export type BotMemory = {
  known: { cardId: string; rank: Rank; turn: number }[]
  lastSnapDiscardId: string | null
}
export function emptyMemory(): BotMemory
export function seedFromInitialPeek(state: GameState, botId: string, level: BotLevel): BotMemory
export function learnCard(mem: BotMemory, cardId: string, rank: Rank, turn: number): BotMemory
export function pruneAbsent(mem: BotMemory, state: GameState): BotMemory
export function knownRank(mem: BotMemory, cardId: string, currentTurn: number, level: BotLevel): Rank | null
export type BotSlot = { cardId: string; index: number; rank: Rank | null }
export type BotView = {
  myId: string
  myHand: BotSlot[]
  opponents: { id: string; hand: BotSlot[] }[]
  topDiscard: Card | null
  deckCount: number
  phase: GamePhase
  bateCallerId: string | null
}
export function buildBotView(state: GameState, botId: string, mem: BotMemory, level: BotLevel): BotView

// src/server/game/bot/decide-turn.ts
export type TurnDecision =
  | { kind: 'swap'; handIndex: number }
  | { kind: 'discard'; useEffect: boolean }
export function decideTurn(view: BotView, drawn: Card, level: BotLevel): TurnDecision

// src/server/game/bot/decide-effect.ts  (EffectInput mirrors engine's resolveEffect input)
export type EffectInput = { targetPlayerId: string; targetCardIndex: number; myCardIndex?: number }
export function decideEffect(view: BotView, effectType: EffectType, level: BotLevel): EffectInput | null

// src/server/game/bot/decide-snap.ts
export function decideSnap(view: BotView, level: BotLevel, rng?: () => number): number | null

// src/server/game/bot/decide-bate.ts
export function decideBate(view: BotView, level: BotLevel): boolean

// src/server/game/bot/index.ts
export function runBotTurn(
  state: GameState, botId: string, mem: BotMemory, level: BotLevel, rng?: () => number,
): { state: GameState; memory: BotMemory }
export type PlannedAction =
  | { kind: 'confirm-peeks' }
  | { kind: 'snap'; botId: string; handIndex: number }
  | { kind: 'turn'; botId: string }
  | null
export function planBotAction(
  state: GameState,
  memories: Map<string, BotMemory>,
  hasConnectedHuman: boolean,
  rng?: () => number,
): PlannedAction

// src/server/game/bot/driver.ts
export function scheduleBotActions(io: SocketServer, roomId: string): void

// src/server/storage/types.ts (Storage interface)
setBotMemory(roomId: string, botId: string, mem: BotMemory): Promise<void>
getBotMemory(roomId: string, botId: string): Promise<BotMemory | undefined>
clearBotMemory(roomId: string): Promise<void>
```

A bot's `botLevel` is read off `state.players[i].botLevel`; helpers default to `'medium'` if absent.

---

### Task 1: Shared types + bot level config + EV constant

**Files:**
- Modify: `bate-backend/src/types/shared.ts` (Player + BotLevel)
- Modify: `bate-frontend/src/types/shared.ts` (identical mirror)
- Create: `bate-backend/src/server/game/bot/config.ts`
- Modify: `bate-backend/src/server/game/scoring.ts` (export `CARD_VALUES`)
- Test: `bate-backend/tests/server/game/bot/config.test.ts`

**Interfaces:**
- Produces: `BotLevel`, `Player.isBot`, `Player.botLevel`, `UNKNOWN_CARD_EV`, `LEVEL_CONFIG`, `LevelConfig`, exported `CARD_VALUES`.

- [ ] **Step 1: Add `BotLevel` + Player fields to BOTH `shared.ts` files**

In `bate-backend/src/types/shared.ts` and `bate-frontend/src/types/shared.ts`, after `export type EffectType = ...` add:
```ts
export type BotLevel = 'easy' | 'medium' | 'hard'
```
And in `Player`, after `arena: string`:
```ts
  arena: string
  isBot?: boolean
  botLevel?: BotLevel
```

- [ ] **Step 2: Export `CARD_VALUES` from `scoring.ts`**

Change `const CARD_VALUES` to `export const CARD_VALUES` in `bate-backend/src/server/game/scoring.ts:3`.

- [ ] **Step 3: Write the failing config test**

`bate-backend/tests/server/game/bot/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { UNKNOWN_CARD_EV, LEVEL_CONFIG } from '@/server/game/bot/config'

describe('config do bot', () => {
  it('valor esperado de carta desconhecida e 576/108 (~5.333)', () => {
    expect(UNKNOWN_CARD_EV).toBeCloseTo(576 / 108, 6)
  })

  it('facil esquece (memoryTurns finito), medio e dificil nunca esquecem', () => {
    expect(LEVEL_CONFIG.easy.memoryTurns).toBe(2)
    expect(LEVEL_CONFIG.medium.memoryTurns).toBe(Infinity)
    expect(LEVEL_CONFIG.hard.memoryTurns).toBe(Infinity)
  })

  it('dificil bate com mao mais alta que facil (limiar maior)', () => {
    expect(LEVEL_CONFIG.hard.bateThreshold).toBeGreaterThan(LEVEL_CONFIG.easy.bateThreshold)
  })
})
```

- [ ] **Step 4: Run it (fails — module missing)**

Run: `cd bate-backend && npx vitest run tests/server/game/bot/config.test.ts`
Expected: FAIL — cannot resolve `@/server/game/bot/config`.

- [ ] **Step 5: Implement `config.ts`**

`bate-backend/src/server/game/bot/config.ts`:
```ts
import type { BotLevel, Rank } from '@/types/shared'
import { CARD_VALUES } from '../scoring'

const STANDARD_RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const STANDARD_COPIES = 8
const JOKER_COPIES = 4
const DECK_TOTAL = STANDARD_RANKS.length * STANDARD_COPIES + JOKER_COPIES
const DECK_VALUE_SUM =
  STANDARD_RANKS.reduce((sum, r) => sum + CARD_VALUES[r] * STANDARD_COPIES, 0) +
  CARD_VALUES.JOKER * JOKER_COPIES

export const UNKNOWN_CARD_EV = DECK_VALUE_SUM / DECK_TOTAL

export type LevelConfig = {
  considerUnknownSwap: boolean
  useEffects: boolean
  snapAccuracy: number
  bateThreshold: number
  memoryTurns: number
  seedInitialCount: 1 | 2
  thinkMs: [number, number]
}

export const LEVEL_CONFIG: Record<BotLevel, LevelConfig> = {
  easy: { considerUnknownSwap: false, useEffects: false, snapAccuracy: 0.4, bateThreshold: 4, memoryTurns: 2, seedInitialCount: 1, thinkMs: [1500, 2500] },
  medium: { considerUnknownSwap: true, useEffects: true, snapAccuracy: 0.8, bateThreshold: 6, memoryTurns: Infinity, seedInitialCount: 2, thinkMs: [1000, 1500] },
  hard: { considerUnknownSwap: true, useEffects: true, snapAccuracy: 1.0, bateThreshold: 8, memoryTurns: Infinity, seedInitialCount: 2, thinkMs: [500, 1000] },
}
```

- [ ] **Step 6: Run it (passes) + typecheck both repos**

Run: `cd bate-backend && npx vitest run tests/server/game/bot/config.test.ts && npx tsc --noEmit`
Run: `cd bate-frontend && npx tsc --noEmit`
Expected: test PASS; both `tsc` print no errors.

- [ ] **Step 7: Commit**

```bash
git add bate-backend/src/types/shared.ts bate-backend/src/server/game/bot/config.ts bate-backend/src/server/game/scoring.ts bate-backend/tests/server/game/bot/config.test.ts
git commit -m "add BotLevel type, bot level config and unknown-card EV constant"
# frontend mirror is a separate repo:
cd ../bate-frontend && git add src/types/shared.ts && git commit -m "mirror BotLevel and Player bot fields from backend"
```

---

### Task 2: Bot belief (`BotMemory` + view builder)

**Files:**
- Create: `bate-backend/src/server/game/bot/belief.ts`
- Create: `bate-backend/tests/server/game/bot/fixtures.ts` (shared test helper)
- Test: `bate-backend/tests/server/game/bot/belief.test.ts`

**Interfaces:**
- Consumes: `LEVEL_CONFIG`, `UNKNOWN_CARD_EV` (Task 1).
- Produces: `BotMemory`, `emptyMemory`, `seedFromInitialPeek`, `learnCard`, `pruneAbsent`, `knownRank`, `BotSlot`, `BotView`, `buildBotView`, and the test fixture `practiceRound`.

Knowledge is keyed by **cardId** (not slot) so it survives Q-swaps and snaps automatically. `revealedToSelf` ranks are read from the true hand at seed time (legal: the human sees those 2 too). `knownRank` returns `null` for cards the bot forgot (easy decay) or never learned — which is how anti-cheat is enforced: `buildBotView` never exposes a rank the bot doesn't legally know.

- [ ] **Step 1: Write the shared fixture**

`bate-backend/tests/server/game/bot/fixtures.ts`:
```ts
import { createEmptyRoom, startRound } from '@/server/game/state'
import type { GameState, BotLevel, Card, Rank, Suit } from '@/types/shared'

export function card(id: string, rank: Rank, suit: Suit | null = 'hearts'): Card {
  return { id, rank, suit }
}

export function practiceRound(botLevels: BotLevel[]): GameState {
  const empty = createEmptyRoom({ roomId: 'R1', name: 'm', hostId: 'human', hostName: 'Eu', maxPlayers: (botLevels.length + 1) as 2 | 3 | 4 })
  botLevels.forEach((level, i) => {
    empty.players.push({
      id: `bot:R1:${i}`, socketId: null, name: `Bot${i}`, hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
      isBot: true, botLevel: level,
    })
  })
  return { ...startRound(empty), phase: 'playing' }
}

export function setHand(state: GameState, playerId: string, hand: Card[], revealed: string[] = []): GameState {
  return {
    ...state,
    players: state.players.map(p => (p.id === playerId ? { ...p, hand, revealedToSelf: revealed } : p)),
  }
}
```

- [ ] **Step 2: Write the failing belief test**

`bate-backend/tests/server/game/bot/belief.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { seedFromInitialPeek, learnCard, knownRank, buildBotView, emptyMemory } from '@/server/game/bot/belief'
import { practiceRound, setHand, card } from './fixtures'

const BOT = 'bot:R1:0'

describe('seedFromInitialPeek', () => {
  it('semeia as 2 cartas reveladas no medio', () => {
    let state = practiceRound(['medium'])
    state = setHand(state, BOT, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    const mem = seedFromInitialPeek(state, BOT, 'medium')
    expect(knownRank(mem, 'c2', 1, 'medium')).toBe('5')
    expect(knownRank(mem, 'c3', 1, 'medium')).toBe('2')
    expect(knownRank(mem, 'c0', 1, 'medium')).toBeNull()
  })

  it('semeia apenas 1 das 2 no facil', () => {
    let state = practiceRound(['easy'])
    state = setHand(state, BOT, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    const mem = seedFromInitialPeek(state, BOT, 'easy')
    const knownCount = ['c2', 'c3'].filter(id => knownRank(mem, id, 1, 'easy') !== null).length
    expect(knownCount).toBe(1)
  })
})

describe('knownRank + decay', () => {
  it('facil esquece carta aprendida ha mais de 2 turnos', () => {
    const mem = learnCard(emptyMemory(), 'x', 'Q', 1)
    expect(knownRank(mem, 'x', 2, 'easy')).toBe('Q')
    expect(knownRank(mem, 'x', 4, 'easy')).toBeNull()
  })

  it('medio nunca esquece', () => {
    const mem = learnCard(emptyMemory(), 'x', 'Q', 1)
    expect(knownRank(mem, 'x', 50, 'medium')).toBe('Q')
  })
})

describe('buildBotView', () => {
  it('expoe rank apenas das cartas conhecidas, esconde o resto', () => {
    let state = practiceRound(['medium'])
    state = setHand(state, BOT, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    const mem = seedFromInitialPeek(state, BOT, 'medium')
    const view = buildBotView(state, BOT, mem, 'medium')
    const known = view.myHand.filter(s => s.rank !== null).map(s => s.cardId).sort()
    expect(known).toEqual(['c2', 'c3'])
    expect(view.opponents[0]!.hand.every(s => s.rank === null)).toBe(true)
  })
})
```

- [ ] **Step 3: Run it (fails — module missing)**

Run: `cd bate-backend && npx vitest run tests/server/game/bot/belief.test.ts`
Expected: FAIL — cannot resolve `@/server/game/bot/belief`.

- [ ] **Step 4: Implement `belief.ts`**

`bate-backend/src/server/game/bot/belief.ts`:
```ts
import type { GameState, BotLevel, Rank, Card, GamePhase } from '@/types/shared'
import { LEVEL_CONFIG } from './config'

export type BotMemory = {
  known: { cardId: string; rank: Rank; turn: number }[]
  lastSnapDiscardId: string | null
}

export function emptyMemory(): BotMemory {
  return { known: [], lastSnapDiscardId: null }
}

export function learnCard(mem: BotMemory, cardId: string, rank: Rank, turn: number): BotMemory {
  const known = mem.known.filter(k => k.cardId !== cardId)
  known.push({ cardId, rank, turn })
  return { ...mem, known }
}

export function seedFromInitialPeek(state: GameState, botId: string, level: BotLevel): BotMemory {
  const bot = state.players.find(p => p.id === botId)
  if (!bot) return emptyMemory()
  const turn = state.roundTurnCount
  const ids = bot.revealedToSelf.slice(0, LEVEL_CONFIG[level].seedInitialCount)
  let mem = emptyMemory()
  for (const id of ids) {
    const c = bot.hand.find(h => h.id === id)
    if (c) mem = learnCard(mem, c.id, c.rank, turn)
  }
  return mem
}

export function pruneAbsent(mem: BotMemory, state: GameState): BotMemory {
  const present = new Set(state.players.flatMap(p => p.hand.map(c => c.id)))
  return { ...mem, known: mem.known.filter(k => present.has(k.cardId)) }
}

export function knownRank(mem: BotMemory, cardId: string, currentTurn: number, level: BotLevel): Rank | null {
  const entry = mem.known.find(k => k.cardId === cardId)
  if (!entry) return null
  const window = LEVEL_CONFIG[level].memoryTurns
  if (Number.isFinite(window) && currentTurn - entry.turn > window) return null
  return entry.rank
}

export type BotSlot = { cardId: string; index: number; rank: Rank | null }

export type BotView = {
  myId: string
  myHand: BotSlot[]
  opponents: { id: string; hand: BotSlot[] }[]
  topDiscard: Card | null
  deckCount: number
  phase: GamePhase
  bateCallerId: string | null
}

export function buildBotView(state: GameState, botId: string, mem: BotMemory, level: BotLevel): BotView {
  const turn = state.roundTurnCount
  const toSlots = (hand: Card[]): BotSlot[] =>
    hand.map((c, index) => ({ cardId: c.id, index, rank: knownRank(mem, c.id, turn, level) }))
  const me = state.players.find(p => p.id === botId)
  return {
    myId: botId,
    myHand: me ? toSlots(me.hand) : [],
    opponents: state.players.filter(p => p.id !== botId).map(p => ({ id: p.id, hand: toSlots(p.hand) })),
    topDiscard: state.discard[state.discard.length - 1] ?? null,
    deckCount: state.deck.length,
    phase: state.phase,
    bateCallerId: state.bateCallerId,
  }
}
```

- [ ] **Step 5: Run it (passes)**

Run: `cd bate-backend && npx vitest run tests/server/game/bot/belief.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add bate-backend/src/server/game/bot/belief.ts bate-backend/tests/server/game/bot/fixtures.ts bate-backend/tests/server/game/bot/belief.test.ts
git commit -m "add bot belief memory and anti-cheat view builder"
```

---

### Task 3: `decideTurn`

**Files:**
- Create: `bate-backend/src/server/game/bot/decide-turn.ts`
- Test: `bate-backend/tests/server/game/bot/decide-turn.test.ts`

**Interfaces:**
- Consumes: `BotView`, `BotSlot` (Task 2), `LEVEL_CONFIG`, `UNKNOWN_CARD_EV`, `CARD_VALUES`.
- Produces: `TurnDecision`, `decideTurn`.

Heuristic: place the drawn card into the slot whose **effective value** (known = exact `CARD_VALUES`; unknown = `UNKNOWN_CARD_EV`, only for medium/hard) is highest **and** strictly greater than the drawn card's value. Otherwise discard the drawn card, using its effect if the level enables effects and there is something to learn (an unknown slot exists).

- [ ] **Step 1: Write the failing test**

`bate-backend/tests/server/game/bot/decide-turn.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { decideTurn } from '@/server/game/bot/decide-turn'
import type { BotView } from '@/server/game/bot/belief'
import { card } from './fixtures'

function view(myHand: BotView['myHand']): BotView {
  return { myId: 'b', myHand, opponents: [{ id: 'o', hand: [{ cardId: 'o0', index: 0, rank: null }] }], topDiscard: null, deckCount: 50, phase: 'playing', bateCallerId: null }
}

describe('decideTurn', () => {
  it('troca carta alta conhecida por carta baixa comprada', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'J' }, { cardId: 'c1', index: 1, rank: '3' }])
    expect(decideTurn(v, card('drawn', '2'), 'medium')).toEqual({ kind: 'swap', handIndex: 0 })
  })

  it('descarta a carta comprada quando ela e pior que tudo que tenho', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '2' }, { cardId: 'c1', index: 1, rank: '3' }])
    const d = decideTurn(v, card('drawn', 'J'), 'medium')
    expect(d.kind).toBe('discard')
  })

  it('nunca descarta K ou JOKER comprado — guarda no lugar de uma desconhecida', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }, { cardId: 'c1', index: 1, rank: null }])
    expect(decideTurn(v, card('drawn', 'K'), 'medium').kind).toBe('swap')
    expect(decideTurn(v, card('drawn', 'JOKER', null), 'medium').kind).toBe('swap')
  })

  it('facil ignora a oportunidade de trocar numa carta desconhecida positiva', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }, { cardId: 'c1', index: 1, rank: null }])
    expect(decideTurn(v, card('drawn', '4'), 'easy').kind).toBe('discard')
  })

  it('facil guarda K comprado mesmo com a mao toda desconhecida', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }, { cardId: 'c1', index: 1, rank: null }])
    expect(decideTurn(v, card('drawn', 'K'), 'easy')).toEqual({ kind: 'swap', handIndex: 0 })
  })

  it('descarta carta de efeito usando o efeito quando ha slot a explorar (medio)', () => {
    const known = view([{ cardId: 'c0', index: 0, rank: 'A' }, { cardId: 'c1', index: 1, rank: null }])
    const d = decideTurn(known, card('drawn', 'J'), 'medium')
    expect(d).toEqual({ kind: 'discard', useEffect: true })
  })
})
```

- [ ] **Step 2: Run it (fails)** — Run: `cd bate-backend && npx vitest run tests/server/game/bot/decide-turn.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `decide-turn.ts`**

```ts
import type { Card, BotLevel } from '@/types/shared'
import type { BotView } from './belief'
import { CARD_VALUES } from '../scoring'
import { LEVEL_CONFIG, UNKNOWN_CARD_EV } from './config'

export type TurnDecision =
  | { kind: 'swap'; handIndex: number }
  | { kind: 'discard'; useEffect: boolean }

const EFFECT_RANKS = new Set(['10', 'J', 'Q'])

function effectiveValue(rank: BotView['myHand'][number]['rank'], considerUnknown: boolean): number | null {
  if (rank !== null) return CARD_VALUES[rank]
  return considerUnknown ? UNKNOWN_CARD_EV : null
}

function bestKnownSlot(view: BotView): BotView['myHand'][number] | undefined {
  return view.myHand.filter(s => s.rank !== null).sort((a, b) => CARD_VALUES[b.rank!] - CARD_VALUES[a.rank!])[0]
}

export function decideTurn(view: BotView, drawn: Card, level: BotLevel): TurnDecision {
  const cfg = LEVEL_CONFIG[level]
  const drawnValue = CARD_VALUES[drawn.rank]

  let best: { index: number; value: number } | null = null
  for (const slot of view.myHand) {
    const value = effectiveValue(slot.rank, cfg.considerUnknownSwap)
    if (value === null) continue
    if (value > drawnValue && (best === null || value > best.value)) {
      best = { index: slot.index, value }
    }
  }

  if (best) return { kind: 'swap', handIndex: best.index }

  if (drawnValue < 0) {
    const target = view.myHand.find(s => s.rank === null) ?? bestKnownSlot(view)
    if (target) return { kind: 'swap', handIndex: target.index }
  }

  const hasUnknownSlot = view.myHand.some(s => s.rank === null)
  const useEffect = cfg.useEffects && EFFECT_RANKS.has(drawn.rank) && hasUnknownSlot
  return { kind: 'discard', useEffect }
}
```

- [ ] **Step 4: Run it (passes) + tsc** — Run: `cd bate-backend && npx vitest run tests/server/game/bot/decide-turn.test.ts && npx tsc --noEmit` → PASS, clean.

- [ ] **Step 5: Commit** — `git add ... && git commit -m "add bot decideTurn heuristic"`

---

### Task 4: `decideEffect`

**Files:**
- Create: `bate-backend/src/server/game/bot/decide-effect.ts`
- Test: `bate-backend/tests/server/game/bot/decide-effect.test.ts`

**Interfaces:**
- Consumes: `BotView` (Task 2), `EffectType` (shared), `CARD_VALUES`.
- Produces: `EffectInput`, `decideEffect`.

`peek-own`: pick first unknown own slot. `peek-other`: pick first unknown opponent slot. `swap` (Q): give my highest **known** card to an opponent in exchange for their lowest **known** card, only if it lowers my score (my high > their low); else `null` (skip). Returns `null` whenever there's nothing useful (driver then calls `skipEffect`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { decideEffect } from '@/server/game/bot/decide-effect'
import type { BotView } from '@/server/game/bot/belief'

function view(myHand: BotView['myHand'], oppHand: BotView['myHand']): BotView {
  return { myId: 'b', myHand, opponents: [{ id: 'o', hand: oppHand }], topDiscard: null, deckCount: 50, phase: 'effect-pending', bateCallerId: null }
}

describe('decideEffect', () => {
  it('peek-own espia a primeira carta propria desconhecida', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '3' }, { cardId: 'c1', index: 1, rank: null }], [])
    expect(decideEffect(v, 'peek-own', 'medium')).toEqual({ targetPlayerId: 'b', targetCardIndex: 1 })
  })

  it('peek-other espia carta desconhecida do oponente', () => {
    const v = view([], [{ cardId: 'o0', index: 0, rank: null }])
    expect(decideEffect(v, 'peek-other', 'medium')).toEqual({ targetPlayerId: 'o', targetCardIndex: 0 })
  })

  it('swap troca minha carta alta conhecida pela baixa conhecida do oponente', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'Q' }], [{ cardId: 'o0', index: 0, rank: '2' }])
    expect(decideEffect(v, 'swap', 'medium')).toEqual({ targetPlayerId: 'o', targetCardIndex: 0, myCardIndex: 0 })
  })

  it('swap pula (null) quando nao ha ganho de troca', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '2' }], [{ cardId: 'o0', index: 0, rank: 'Q' }])
    expect(decideEffect(v, 'swap', 'medium')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it (fails)** — FAIL (module missing).

- [ ] **Step 3: Implement `decide-effect.ts`**

```ts
import type { BotLevel, EffectType } from '@/types/shared'
import type { BotView, BotSlot } from './belief'
import { CARD_VALUES } from '../scoring'

export type EffectInput = { targetPlayerId: string; targetCardIndex: number; myCardIndex?: number }

function firstUnknown(hand: BotSlot[]): BotSlot | undefined {
  return hand.find(s => s.rank === null)
}

function highestKnown(hand: BotSlot[]): BotSlot | undefined {
  return hand.filter(s => s.rank !== null).sort((a, b) => CARD_VALUES[b.rank!] - CARD_VALUES[a.rank!])[0]
}

function lowestKnown(hand: BotSlot[]): BotSlot | undefined {
  return hand.filter(s => s.rank !== null).sort((a, b) => CARD_VALUES[a.rank!] - CARD_VALUES[b.rank!])[0]
}

export function decideEffect(view: BotView, effectType: EffectType, _level: BotLevel): EffectInput | null {
  if (effectType === 'peek-own') {
    const slot = firstUnknown(view.myHand) ?? view.myHand[0]
    return slot ? { targetPlayerId: view.myId, targetCardIndex: slot.index } : null
  }

  if (effectType === 'peek-other') {
    for (const opp of view.opponents) {
      const slot = firstUnknown(opp.hand)
      if (slot) return { targetPlayerId: opp.id, targetCardIndex: slot.index }
    }
    const opp = view.opponents[0]
    return opp && opp.hand[0] ? { targetPlayerId: opp.id, targetCardIndex: 0 } : null
  }

  const mine = highestKnown(view.myHand)
  if (!mine || mine.rank === null) return null
  for (const opp of view.opponents) {
    const theirs = lowestKnown(opp.hand)
    if (theirs && theirs.rank !== null && CARD_VALUES[theirs.rank] < CARD_VALUES[mine.rank]) {
      return { targetPlayerId: opp.id, targetCardIndex: theirs.index, myCardIndex: mine.index }
    }
  }
  return null
}
```

- [ ] **Step 4: Run it (passes) + tsc** → PASS, clean.

- [ ] **Step 5: Commit** — `git commit -m "add bot decideEffect (peek/swap targeting)"`

---

### Task 5: `decideSnap`

**Files:**
- Create: `bate-backend/src/server/game/bot/decide-snap.ts`
- Test: `bate-backend/tests/server/game/bot/decide-snap.test.ts`

**Interfaces:**
- Consumes: `BotView` (Task 2), `LEVEL_CONFIG`.
- Produces: `decideSnap`.

Returns the `handIndex` of a **known** card whose rank equals the top discard rank, gated by `snapAccuracy` via an injectable `rng` (default `Math.random`). Bots never snap an unknown card.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { decideSnap } from '@/server/game/bot/decide-snap'
import type { BotView } from '@/server/game/bot/belief'
import { card } from './fixtures'

function view(myHand: BotView['myHand'], topRank: 'A' | '5' | 'K'): BotView {
  return { myId: 'b', myHand, opponents: [], topDiscard: card('top', topRank), deckCount: 50, phase: 'playing', bateCallerId: null }
}

describe('decideSnap', () => {
  it('da snap quando conhece carta de rank igual ao topo do descarte', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: 'K' }, { cardId: 'c1', index: 1, rank: '5' }], '5')
    expect(decideSnap(v, 'hard', () => 0)).toBe(1)
  })

  it('nao da snap em carta desconhecida mesmo que pudesse casar', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: null }], '5')
    expect(decideSnap(v, 'hard', () => 0)).toBeNull()
  })

  it('facil ignora parte das chances (rng acima da precisao)', () => {
    const v = view([{ cardId: 'c0', index: 0, rank: '5' }], '5')
    expect(decideSnap(v, 'easy', () => 0.5)).toBeNull()
    expect(decideSnap(v, 'hard', () => 0.5)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it (fails)** → FAIL.

- [ ] **Step 3: Implement `decide-snap.ts`**

```ts
import type { BotLevel } from '@/types/shared'
import type { BotView } from './belief'
import { LEVEL_CONFIG } from './config'

export function decideSnap(view: BotView, level: BotLevel, rng: () => number = Math.random): number | null {
  const top = view.topDiscard
  if (!top) return null
  const match = view.myHand.find(s => s.rank === top.rank)
  if (!match) return null
  if (rng() >= LEVEL_CONFIG[level].snapAccuracy) return null
  return match.index
}
```

- [ ] **Step 4: Run it (passes) + tsc** → PASS, clean.

- [ ] **Step 5: Commit** — `git commit -m "add bot decideSnap with difficulty-gated accuracy"`

---

### Task 6: `decideBate`

**Files:**
- Create: `bate-backend/src/server/game/bot/decide-bate.ts`
- Test: `bate-backend/tests/server/game/bot/decide-bate.test.ts`

**Interfaces:**
- Consumes: `BotView` (Task 2), `LEVEL_CONFIG`, `UNKNOWN_CARD_EV`, `CARD_VALUES`.
- Produces: `decideBate`, `estimateHand`.

Estimate own hand: known = exact, unknown = `UNKNOWN_CARD_EV`. Bate when `estimate <= bateThreshold` and bate has not already been called (`bateCallerId === null`). The driver only invokes this in phase `playing` on the bot's turn (so `callBate`'s `INVALID_PHASE`/`NOT_YOUR_TURN` never fire).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { decideBate, estimateHand } from '@/server/game/bot/decide-bate'
import type { BotView } from '@/server/game/bot/belief'

function view(myHand: BotView['myHand'], bateCallerId: string | null = null): BotView {
  return { myId: 'b', myHand, opponents: [], topDiscard: null, deckCount: 50, phase: 'playing', bateCallerId }
}

describe('decideBate', () => {
  it('estima carta desconhecida pelo valor esperado', () => {
    const e = estimateHand(view([{ cardId: 'c0', index: 0, rank: null }]))
    expect(e).toBeCloseTo(576 / 108, 6)
  })

  it('dificil bate com mao 7, facil nao (limiar 8 vs 4)', () => {
    const hand: BotView['myHand'] = [{ cardId: 'a', index: 0, rank: '3' }, { cardId: 'b', index: 1, rank: '4' }]
    expect(decideBate(view(hand), 'hard')).toBe(true)
    expect(decideBate(view(hand), 'easy')).toBe(false)
  })

  it('nao bate se o bate ja foi chamado', () => {
    const hand: BotView['myHand'] = [{ cardId: 'a', index: 0, rank: 'K' }]
    expect(decideBate(view(hand, 'someoneElse'), 'hard')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it (fails)** → FAIL.

- [ ] **Step 3: Implement `decide-bate.ts`**

```ts
import type { BotLevel } from '@/types/shared'
import type { BotView } from './belief'
import { CARD_VALUES } from '../scoring'
import { LEVEL_CONFIG, UNKNOWN_CARD_EV } from './config'

export function estimateHand(view: BotView): number {
  return view.myHand.reduce((sum, s) => sum + (s.rank !== null ? CARD_VALUES[s.rank] : UNKNOWN_CARD_EV), 0)
}

export function decideBate(view: BotView, level: BotLevel): boolean {
  if (view.bateCallerId !== null) return false
  return estimateHand(view) <= LEVEL_CONFIG[level].bateThreshold
}
```

- [ ] **Step 4: Run it (passes) + tsc** → PASS, clean.

- [ ] **Step 5: Commit** — `git commit -m "add bot decideBate with expected-value hand estimate"`

---

### Task 7: `runBotTurn` + `planBotAction` orchestrator + bot-vs-bot convergence

**Files:**
- Create: `bate-backend/src/server/game/bot/index.ts`
- Test: `bate-backend/tests/server/game/bot/index.test.ts`
- Test: `bate-backend/tests/server/game/bot/integration.test.ts`

**Interfaces:**
- Consumes: every decide-* helper, `belief`, engine functions (`drawFromDeck`, `swapAndDiscard`, `discardDrawnCard`, `resolveEffect`, `skipEffect`, `callBate`, `snapCard`), `LEVEL_CONFIG`.
- Produces: `runBotTurn`, `PlannedAction`, `planBotAction`.

`runBotTurn` composes pure engine calls for one full bot turn: bate check → draw → swap/discard → resolve/skip the follow-up effect (recall `swapAndDiscard` **always** triggers the old card's effect; `discardDrawnCard(useEffect=false)` does not). It also folds learned ranks (peeks, seeded reveals) into the returned `BotMemory`. `planBotAction` chooses the single next bot action for the driver, priority: confirm-peeks (phase `initial-peek`) → snap (a bot knows a match it hasn't snapped yet) → turn (current player is a bot). Returns `null` when no human is connected, the room is paused, or no bot action is pending.

- [ ] **Step 1: Write the failing orchestrator test**

`bate-backend/tests/server/game/bot/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runBotTurn, planBotAction } from '@/server/game/bot/index'
import { seedFromInitialPeek } from '@/server/game/bot/belief'
import { practiceRound } from './fixtures'

const BOT = 'bot:R1:0'

describe('runBotTurn', () => {
  it('avanca o turno e nunca lanca para qualquer mao inicial', () => {
    let state = practiceRound(['hard'])
    state = { ...state, turn: state.players.findIndex(p => p.id === BOT) }
    const mem = seedFromInitialPeek(state, BOT, 'hard')
    const before = state.roundTurnCount
    const out = runBotTurn(state, BOT, mem, 'hard', () => 0)
    expect(out.state.phase === 'effect-pending').toBe(false)
    expect(out.state.roundTurnCount).toBeGreaterThanOrEqual(before)
  })
})

describe('planBotAction', () => {
  it('retorna null quando nao ha humano conectado', () => {
    const state = practiceRound(['medium'])
    expect(planBotAction(state, new Map(), false)).toBeNull()
  })

  it('confirma peeks na fase initial-peek', () => {
    const state = { ...practiceRound(['medium']), phase: 'initial-peek' as const }
    expect(planBotAction(state, new Map(), true)).toEqual({ kind: 'confirm-peeks' })
  })
})
```

- [ ] **Step 2: Write the failing convergence test**

`bate-backend/tests/server/game/bot/integration.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runBotTurn } from '@/server/game/bot/index'
import { seedFromInitialPeek, pruneAbsent, type BotMemory } from '@/server/game/bot/belief'
import { practiceRound } from './fixtures'
import type { GameState } from '@/types/shared'

describe('bot-vs-bot', () => {
  it('uma rodada so de bots termina sem lancar e converge', () => {
    let state: GameState = { ...practiceRound(['hard', 'hard']), turn: 0 }
    const mems = new Map<string, BotMemory>()
    for (const p of state.players) mems.set(p.id, seedFromInitialPeek(state, p.id, 'hard'))

    const CAP = 400
    let i = 0
    while (state.phase === 'playing' || state.phase === 'bate-called') {
      if (i++ > CAP) throw new Error('bot loop nao convergiu')
      const botId = state.players[state.turn]!.id
      const out = runBotTurn(state, botId, mems.get(botId)!, 'hard', () => 0.99)
      state = out.state
      mems.set(botId, pruneAbsent(out.memory, state))
    }
    expect(['round-end', 'match-end', 'final-snap']).toContain(state.phase)
  })
})
```

- [ ] **Step 3: Run them (fail)** — Run: `cd bate-backend && npx vitest run tests/server/game/bot/index.test.ts tests/server/game/bot/integration.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `index.ts`**

```ts
import type { GameState, BotLevel, Player } from '@/types/shared'
import {
  drawFromDeck, swapAndDiscard, discardDrawnCard, resolveEffect, skipEffect, callBate,
} from '../engine'
import { buildBotView, learnCard, type BotMemory } from './belief'
import { decideTurn } from './decide-turn'
import { decideEffect } from './decide-effect'
import { decideSnap } from './decide-snap'
import { decideBate } from './decide-bate'

function botPlayers(state: GameState): Player[] {
  return state.players.filter(p => p.isBot)
}

function levelOf(player: Player | undefined): BotLevel {
  return player?.botLevel ?? 'medium'
}

export function runBotTurn(
  state: GameState, botId: string, mem: BotMemory, level: BotLevel, rng: () => number = Math.random,
): { state: GameState; memory: BotMemory } {
  let memory = mem

  if (state.phase === 'playing') {
    const view = buildBotView(state, botId, memory, level)
    if (decideBate(view, level)) {
      return { state: callBate(state, botId), memory }
    }
  }

  const drawn = drawFromDeck(state, botId)
  if (!drawn.card) return { state: drawn.state, memory }
  let next = drawn.state
  const card = drawn.card

  const view = buildBotView(next, botId, memory, level)
  const decision = decideTurn(view, card, level)
  next = decision.kind === 'swap'
    ? swapAndDiscard(next, botId, card, decision.handIndex)
    : discardDrawnCard(next, botId, card, decision.kind === 'discard' && decision.useEffect)

  if (next.phase === 'effect-pending' && next.pendingEffect?.playerId === botId) {
    const effectType = next.pendingEffect.type
    if (!levelUsesEffects(level)) {
      next = skipEffect(next, botId)
    } else {
      const evView = buildBotView(next, botId, memory, level)
      const input = decideEffect(evView, effectType, level)
      if (!input) {
        next = skipEffect(next, botId)
      } else {
        const resolved = resolveEffect(next, botId, input)
        next = resolved.state
        for (const r of resolved.revealed) {
          memory = learnCard(memory, r.card.id, r.card.rank, state.roundTurnCount)
        }
      }
    }
  }

  return { state: next, memory }
}

function levelUsesEffects(level: BotLevel): boolean {
  return level !== 'easy'
}

export type PlannedAction =
  | { kind: 'confirm-peeks' }
  | { kind: 'snap'; botId: string; handIndex: number }
  | { kind: 'turn'; botId: string }
  | null

export function planBotAction(
  state: GameState,
  memories: Map<string, BotMemory>,
  hasConnectedHuman: boolean,
  rng: () => number = Math.random,
): PlannedAction {
  if (!hasConnectedHuman || state.paused) return null
  if (botPlayers(state).length === 0) return null

  if (state.phase === 'initial-peek') return { kind: 'confirm-peeks' }

  if (state.phase === 'playing' || state.phase === 'bate-called' || state.phase === 'final-snap') {
    const top = state.discard[state.discard.length - 1]
    if (top) {
      for (const bot of botPlayers(state)) {
        const mem = memories.get(bot.id)
        if (!mem || mem.lastSnapDiscardId === top.id) continue
        const view = buildBotView(state, bot.id, mem, levelOf(bot))
        const handIndex = decideSnap(view, levelOf(bot), rng)
        if (handIndex !== null) return { kind: 'snap', botId: bot.id, handIndex }
      }
    }
  }

  if (state.phase === 'playing' || state.phase === 'bate-called') {
    const current = state.players[state.turn]
    if (current?.isBot) return { kind: 'turn', botId: current.id }
  }

  return null
}
```

- [ ] **Step 5: Run them (pass) + tsc** — Run: `cd bate-backend && npx vitest run tests/server/game/bot/ && npx tsc --noEmit` → PASS, clean.

- [ ] **Step 6: Commit** — `git commit -m "add bot turn orchestrator, action planner and bot-vs-bot convergence test"`

---

### Task 8: Storage `BotMemory` (interface + Memory + Redis + lobby + contract test)

**Files:**
- Modify: `bate-backend/src/server/storage/types.ts`
- Modify: `bate-backend/src/server/storage/memory.ts`
- Modify: `bate-backend/src/server/storage/redis.ts`
- Modify: `bate-backend/src/server/lobby.ts`
- Test: `bate-backend/tests/server/storage/storage-contract.test.ts` (add to parameterized suite)

**Interfaces:**
- Consumes: `BotMemory` (Task 2).
- Produces: `Storage.setBotMemory/getBotMemory/clearBotMemory` + `lobby.*` pass-throughs.

`BotMemory` is JSON-safe (arrays), so Redis `JSON.stringify`/`JSON.parse` round-trips losslessly. Key shape is **per-room** (`Map<roomId, Map<botId, BotMemory>>` / `bate:botmem:<roomId>` hash), so `clearBotMemory(roomId)` is one delete and `removeRoom` wipes it.

- [ ] **Step 1: Write the failing contract assertions** — inside `runStorageContract(...)` in `tests/server/storage/storage-contract.test.ts`, right after `it('faz roundtrip da carta sacada', ...)`:
```ts
    it('faz roundtrip da memoria do bot e limpa por sala', async () => {
      const mem = { known: [{ cardId: 'c1', rank: 'K' as const, turn: 3 }], lastSnapDiscardId: null }
      await storage.setBotMemory('ROOM1', 'bot:ROOM1:0', mem)
      expect(await storage.getBotMemory('ROOM1', 'bot:ROOM1:0')).toEqual(mem)
      await storage.clearBotMemory('ROOM1')
      expect(await storage.getBotMemory('ROOM1', 'bot:ROOM1:0')).toBeUndefined()
    })
```

- [ ] **Step 2: Run it (fails)** — Run: `cd bate-backend && npx vitest run tests/server/storage/storage-contract.test.ts` → FAIL (`setBotMemory` not a function) + `tsc` errors (interface not satisfied).

- [ ] **Step 3: Add to the `Storage` interface** (`storage/types.ts`, after `clearDrawnCard` line 39), and import `BotMemory`:
```ts
import type { Card, GameState, RoomSummary } from '@/types/shared'
import type { BotMemory } from '../game/bot/belief'
// ...
  setBotMemory(roomId: string, botId: string, mem: BotMemory): Promise<void>
  getBotMemory(roomId: string, botId: string): Promise<BotMemory | undefined>
  clearBotMemory(roomId: string): Promise<void>
```

- [ ] **Step 4: Implement in `MemoryStorage`** — add field next to the other Maps (line ~27) and methods next to `clearDrawnCard`:
```ts
  private botMemory = new Map<string, Map<string, BotMemory>>()
  // ...
  async setBotMemory(roomId: string, botId: string, mem: BotMemory): Promise<void> {
    let inner = this.botMemory.get(roomId)
    if (!inner) { inner = new Map(); this.botMemory.set(roomId, inner) }
    inner.set(botId, mem)
  }

  async getBotMemory(roomId: string, botId: string): Promise<BotMemory | undefined> {
    return this.botMemory.get(roomId)?.get(botId)
  }

  async clearBotMemory(roomId: string): Promise<void> {
    this.botMemory.delete(roomId)
  }
```
And add `this.botMemory.clear()` to `clear()`. Import `BotMemory` at top.

- [ ] **Step 5: Implement in `RedisStorage`** — add the key + methods, and wire `removeRoom`/`clear`:
```ts
const BOT_MEMORY_KEY = (roomId: string) => `bate:botmem:${roomId}`
// ...
  async setBotMemory(roomId: string, botId: string, mem: BotMemory): Promise<void> {
    await this.withClient(async c => {
      const multi = c.multi()
      multi.hSet(BOT_MEMORY_KEY(roomId), botId, JSON.stringify(mem))
      multi.expire(BOT_MEMORY_KEY(roomId), Math.ceil(ROOM_TTL_MS / 1000))
      await multi.exec()
    })
  }

  async getBotMemory(roomId: string, botId: string): Promise<BotMemory | undefined> {
    return this.withClient(async c => {
      const raw = await c.hGet(BOT_MEMORY_KEY(roomId), botId)
      return raw ? (JSON.parse(raw) as BotMemory) : undefined
    })
  }

  async clearBotMemory(roomId: string): Promise<void> {
    await this.withClient(c => c.del(BOT_MEMORY_KEY(roomId)))
  }
```
In `removeRoom`'s `multi`, add `multi.del(BOT_MEMORY_KEY(roomId))`. In `clear()`, add `'bate:botmem:*'` to the SCAN `patterns` array. Import `BotMemory` at top.

- [ ] **Step 6: Add `lobby.ts` pass-throughs** — after `clearDrawnCard` (line ~66), mirror the trio, and import `BotMemory`:
```ts
  setBotMemory(roomId: string, botId: string, mem: BotMemory): Promise<void> {
    return getStorage().setBotMemory(roomId, botId, mem)
  },
  getBotMemory(roomId: string, botId: string): Promise<BotMemory | undefined> {
    return getStorage().getBotMemory(roomId, botId)
  },
  clearBotMemory(roomId: string): Promise<void> {
    return getStorage().clearBotMemory(roomId)
  },
```

- [ ] **Step 7: Run the contract test (passes for Memory) + tsc** — Run: `cd bate-backend && npx vitest run tests/server/storage/storage-contract.test.ts && npx tsc --noEmit` → PASS (Memory; Redis branch skips without `TEST_REDIS_URL`), tsc clean.

- [ ] **Step 8 (optional, needs local Redis): verify Redis branch** — Run: `cd bate-backend && pnpm test:redis` (requires redis on :6379). Expected: the bot-memory roundtrip passes against RedisStorage too (proves the JSON-safe shape).

- [ ] **Step 9: Commit** — `git commit -m "add per-room bot memory to storage abstraction (memory + redis + lobby)"`

---

### Task 9: Bot driver (`scheduleBotActions`)

**Files:**
- Create: `bate-backend/src/server/game/bot/driver.ts`
- Test: `bate-backend/tests/server/game/bot/driver.test.ts`

**Interfaces:**
- Consumes: `planBotAction`, `runBotTurn` (Task 7); `lobby` (incl. Task 8 methods); engine `snapCard`, `startTurnTimer`; `broadcastRoom` (re-trigger); `seedFromInitialPeek` (re-seed on each round); `LEVEL_CONFIG`.
- Produces: `scheduleBotActions(io, roomId)`.

Mirrors `final-snap.ts`'s timer registry exactly: per-room `Map<roomId, Timeout>`, clear-existing, `delete`-then-`withRoomLock` in the callback, re-validate room/phase. **Only schedules** — never locks synchronously (deadlock guard). After executing one action it calls `broadcastRoom`, which re-invokes `scheduleBotActions` (the loop). When `planBotAction` returns `null`, it stops (no new timer).

- [ ] **Step 1: Write the failing driver test** (fake timers + fake io + mocked lobby, mirroring `final-snap.test.ts`):

`bate-backend/tests/server/game/bot/driver.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GameState } from '@/types/shared'
import { practiceRound, setHand, card } from './fixtures'
import { seedFromInitialPeek } from '@/server/game/bot/belief'

const rooms = new Map<string, GameState>()
const botMems = new Map<string, unknown>()
vi.mock('@/server/lobby', () => ({ lobby: {
  getRoom: async (id: string) => rooms.get(id),
  setRoom: async (s: GameState) => { rooms.set(s.roomId, s) },
  withRoomLock: async (_id: string, fn: () => unknown) => fn(),
  getBotMemory: async (roomId: string, botId: string) => botMems.get(`${roomId}:${botId}`),
  setBotMemory: async (roomId: string, botId: string, mem: unknown) => { botMems.set(`${roomId}:${botId}`, mem) },
  addPeekConfirmation: async (_r: string, _p: string) => 99,
  clearPeekConfirmations: async () => {},
} }))
vi.mock('@/server/handlers/broadcast', () => ({ broadcastRoom: () => {} }))

import { scheduleBotActions } from '@/server/game/bot/driver'

function fakeIo(connectedSocketIds: string[]) {
  return { sockets: { sockets: { has: (id: string) => connectedSocketIds.includes(id) } }, to: () => ({ emit: () => {} }) } as never
}

beforeEach(() => { vi.useFakeTimers(); rooms.clear(); botMems.clear() })
afterEach(() => { vi.useRealTimers() })

describe('scheduleBotActions', () => {
  it('nao age quando nao ha humano conectado', async () => {
    const state = { ...practiceRound(['hard']), turn: 1 }
    rooms.set(state.roomId, state)
    scheduleBotActions(fakeIo([]), state.roomId)
    await vi.advanceTimersByTimeAsync(5000)
    expect(rooms.get(state.roomId)!.roundTurnCount).toBe(state.roundTurnCount)
  })

  it('executa o turno do bot quando e a vez dele e ha humano', async () => {
    let state = { ...practiceRound(['hard']), turn: 1 }
    state = { ...state, players: state.players.map(p => (p.isBot ? p : { ...p, socketId: 'sock-human' })) }
    const botId = state.players[1]!.id
    state = setHand(state, botId, [card('c0', 'K'), card('c1', '9'), card('c2', '5'), card('c3', '2')], ['c2', 'c3'])
    rooms.set(state.roomId, state)
    botMems.set(`${state.roomId}:${botId}`, seedFromInitialPeek(state, botId, 'hard'))
    scheduleBotActions(fakeIo(['sock-human']), state.roomId)
    await vi.advanceTimersByTimeAsync(3000)
    const after = rooms.get(state.roomId)!
    expect(after.log.some(l => l.actorId === botId)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it (fails)** → FAIL (module missing).

- [ ] **Step 3: Implement `driver.ts`**

```ts
import type { Server as SocketServer } from 'socket.io'
import type { GameState, BotLevel } from '@/types/shared'
import { lobby } from '@/server/lobby'
import { snapCard, startTurnTimer } from '../engine'
import { broadcastRoom } from '@/server/handlers/broadcast'
import { log } from '@/server/logger'
import { planBotAction, runBotTurn } from './index'
import { seedFromInitialPeek, pruneAbsent, type BotMemory } from './belief'
import { LEVEL_CONFIG } from './config'

const botTimers = new Map<string, ReturnType<typeof setTimeout>>()

function levelOf(level: BotLevel | undefined): BotLevel {
  return level ?? 'medium'
}

function pickThinkMs(state: GameState): number {
  const bot = state.players.find(p => p.isBot && p.id === state.players[state.turn]?.id) ?? state.players.find(p => p.isBot)
  const [lo, hi] = LEVEL_CONFIG[levelOf(bot?.botLevel)].thinkMs
  return lo + Math.floor(Math.random() * (hi - lo))
}

export function scheduleBotActions(io: SocketServer, roomId: string): void {
  const existing = botTimers.get(roomId)
  if (existing) clearTimeout(existing)

  const peek = botTimers.has(roomId)
  void (async () => {
    const snapshot = await lobby.getRoom(roomId)
    if (!snapshot || !snapshot.players.some(p => p.isBot)) return
    const delay = pickThinkMs(snapshot)

    const timer = setTimeout(() => {
      botTimers.delete(roomId)
      void (async () => {
        await lobby.withRoomLock(roomId, async () => {
          const state = await lobby.getRoom(roomId)
          if (!state || !state.players.some(p => p.isBot)) return
          const hasHuman = state.players.some(
            p => !p.isBot && p.socketId !== null && io.sockets.sockets.has(p.socketId),
          )
          const memories = new Map<string, BotMemory>()
          for (const bot of state.players.filter(p => p.isBot)) {
            memories.set(bot.id, (await lobby.getBotMemory(roomId, bot.id)) ?? seedFromInitialPeek(state, bot.id, levelOf(bot.botLevel)))
          }

          const action = planBotAction(state, memories, hasHuman)
          if (!action) return

          if (action.kind === 'confirm-peeks') {
            let count = 0
            for (const bot of state.players.filter(p => p.isBot)) {
              count = await lobby.addPeekConfirmation(roomId, bot.id)
            }
            if (count >= state.players.length) {
              await lobby.clearPeekConfirmations(roomId)
              const next = startTurnTimer({ ...state, phase: 'playing' as const })
              await lobby.setRoom(next)
              broadcastRoom(io, next)
            }
            return
          }

          if (action.kind === 'snap') {
            const top = state.discard[state.discard.length - 1]
            const next = snapCard(state, action.botId, action.handIndex)
            await lobby.setRoom(next)
            const mem = memories.get(action.botId)!
            await lobby.setBotMemory(roomId, action.botId, { ...mem, lastSnapDiscardId: top?.id ?? null })
            broadcastRoom(io, next)
            return
          }

          const bot = state.players.find(p => p.id === action.botId)!
          const mem = memories.get(action.botId)!
          const out = runBotTurn(state, action.botId, mem, levelOf(bot.botLevel))
          await lobby.setRoom(out.state)
          await lobby.setBotMemory(roomId, action.botId, pruneAbsent(out.memory, out.state))
          broadcastRoom(io, out.state)
        })
      })().catch(err => log.error('bot-driver', 'tick failed', { roomId, error: err instanceof Error ? err.message : 'UNKNOWN' }))
    }, delay)

    botTimers.set(roomId, timer)
  })().catch(err => log.error('bot-driver', 'schedule failed', { roomId, peek, error: err instanceof Error ? err.message : 'UNKNOWN' }))
}
```

> The snap path sets `lastSnapDiscardId` to the matched discard's id so the same bot doesn't re-evaluate the same top discard every tick.

- [ ] **Step 4: Run it (passes) + tsc** — Run: `cd bate-backend && npx vitest run tests/server/game/bot/driver.test.ts && npx tsc --noEmit` → PASS, clean.

- [ ] **Step 5: Commit** — `git commit -m "add bot driver scheduling one action per tick"`

---

### Task 10: `room:create-practice` handler, schema, round-lifecycle cleanup, broadcast trigger

**Files:**
- Modify: `bate-backend/src/server/handlers/schemas.ts`
- Modify: `bate-backend/src/server/handlers/lobby-handlers.ts`
- Modify: `bate-backend/src/server/handlers/broadcast.ts`
- Modify: `bate-backend/src/server/handlers/game-handlers.ts` (clearBotMemory on round transitions)
- Test: `bate-backend/tests/server/handlers/practice.test.ts`

**Interfaces:**
- Consumes: `scheduleBotActions` (Task 9), `seedFromInitialPeek` (Task 2), `startRound`, `lobby.createRoom/setRoom/clearBotMemory`.
- Produces: socket event `room:create-practice`, `RoomCreatePracticeSchema`.

- [ ] **Step 1: Add the schema** — `schemas.ts`, after `RoomCreateSchema`:
```ts
export const RoomCreatePracticeSchema = z.object({
  hostId: playerId,
  hostName: playerName,
  bots: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  level: z.enum(['easy', 'medium', 'hard']),
  turnTimeLimitSec: z.number().int().min(0).max(600).nullable().optional(),
})
```

- [ ] **Step 2: Write the failing handler test** (drives the registered handler with a fake socket/io + real MemoryStorage via `setStorage`):

`bate-backend/tests/server/handlers/practice.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setStorage } from '@/server/storage'
import { MemoryStorage } from '@/server/storage/memory'
import { lobby } from '@/server/lobby'
import { registerLobbyHandlers } from '@/server/handlers/lobby-handlers'

function fakeSocket(playerId: string) {
  const handlers = new Map<string, (raw: unknown, ack: (r: unknown) => void) => void>()
  return {
    socket: { data: { playerId }, on: (e: string, fn: never) => handlers.set(e, fn as never), join: () => {}, leave: () => {}, id: 's1' } as never,
    emit: (e: string, raw: unknown) => new Promise<any>(res => handlers.get(e)!(raw, res)),
  }
}
const io = { to: () => ({ emit: () => {} }), sockets: { sockets: { has: () => true } } } as never

beforeEach(() => { setStorage(new MemoryStorage()) })

describe('room:create-practice', () => {
  it('cria sala privada com N bots e ja inicia a rodada', async () => {
    const { socket, emit } = fakeSocket('11111111-1111-1111-1111-111111111111')
    registerLobbyHandlers(io, socket)
    const res = await emit('room:create-practice', { hostId: '00000000-0000-0000-0000-000000000000', hostName: 'Eu', bots: 2, level: 'hard' })
    expect(res.roomId).toBeTruthy()
    const room = await lobby.getRoom(res.roomId)
    expect(room!.players.filter(p => p.isBot)).toHaveLength(2)
    expect(room!.private).toBe(true)
    expect(['initial-peek', 'playing']).toContain(room!.phase)
  })
})
```

- [ ] **Step 3: Run it (fails)** → FAIL (event not handled → `handlers.get` undefined).

- [ ] **Step 4: Implement the handler** — in `lobby-handlers.ts`, add imports (`RoomCreatePracticeSchema`, `startRound` from `../game/state`, `scheduleBotActions` from `../game/bot/driver`, `seedFromInitialPeek` from `../game/bot/belief`, `BotLevel`/`Player` types), and register next to `room:create`:
```ts
const BOT_NAMES = ['Batinho', 'Nozes', 'Castanha']

socket.on('room:create-practice', async (raw: unknown, ack: (res: { roomId?: string; error?: string }) => void) => {
  const payload = parseAndAuth(RoomCreatePracticeSchema, raw, ack, socket)
  if (!payload) return
  try {
    const [deck, arena] = await Promise.all([lookupDeck(payload.hostId), lookupArena(payload.hostId)])
    const room = await lobby.createRoom({
      name: 'Treino', hostId: payload.hostId, hostName: payload.hostName,
      maxPlayers: (payload.bots + 1) as 2 | 3 | 4, deck, arena, private: true,
      turnTimeLimitSec: payload.turnTimeLimitSec ?? 60,
    })
    const bots: Player[] = Array.from({ length: payload.bots }, (_, i) => ({
      id: `bot:${room.roomId}:${i}`, socketId: null, name: BOT_NAMES[i] ?? `Bot ${i + 1}`,
      hand: [], score: 0, connected: true, disconnectedAt: null, revealedToSelf: [],
      deck: 'default', arena: 'default', isBot: true, botLevel: payload.level as BotLevel,
    }))
    const withBots = { ...room, players: [...room.players, ...bots] }
    const started = startRound(withBots)
    await lobby.setRoom(started)
    for (const bot of bots) {
      await lobby.setBotMemory(started.roomId, bot.id, seedFromInitialPeek(started, bot.id, payload.level as BotLevel))
    }
    ack({ roomId: started.roomId })
    broadcastRoom(io, started)
    io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
    scheduleBotActions(io, started.roomId)
  } catch (err) {
    ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
  }
})
```
(Import `broadcastRoom` — already imported in this file.)

- [ ] **Step 5: Wire the broadcast trigger** — at the very end of `broadcastRoom` in `broadcast.ts`, after `gameEvents.emitBroadcast(...)`:
```ts
  if (state.players.some(p => p.isBot)) scheduleBotActions(io, state.roomId)
```
Import `scheduleBotActions` from `../game/bot/driver`. (This is `setTimeout`-only, so it is safe to call from inside a `withRoomLock` block.)

- [ ] **Step 6: Wire round-lifecycle cleanup** — in `game-handlers.ts`, in the `game:next-round` handler, after `finishRound(room)` and before/around the re-`startRound`, add `await lobby.clearBotMemory(room.roomId)` so each new round re-seeds memory (the practice handler / next broadcast re-seeds via the driver's `?? seedFromInitialPeek`). Mirror the existing `clearPeekConfirmations` call site.

- [ ] **Step 6b: Tear down a practice room when the human leaves**

The idle sweep only visits **non-private** rooms (`MemoryStorage.listRooms` filters `!s.private`; Redis excludes private rooms from `SUMMARIES_KEY`). Practice rooms are `private: true`, so they are never swept — when the human leaves, the room stays alive with only bots (forever on Memory, until the 30-min Redis TTL). Fix `leaveRoom` (`lobby-handlers.ts`) to remove a room whose remaining players are all bots, in **both** the in-game and the waiting/round-end branches:
```ts
    const inGame = room.phase !== 'waiting' && room.phase !== 'round-end' && room.phase !== 'match-end'
    if (inGame) {
      const adjusted = removePlayerMidGame(room, playerId)
      if (adjusted.players.length === 0 || adjusted.players.every(p => p.isBot)) {
        await lobby.removeRoom(roomId)
        await lobby.clearBotMemory(roomId)
        return null
      }
      await lobby.setRoom(adjusted)
      return adjusted
    }
    const next = await lobby.removePlayer(roomId, playerId)
    if (next && next.players.every(p => p.isBot)) {
      await lobby.removeRoom(roomId)
      await lobby.clearBotMemory(roomId)
      return null
    }
    return next ?? null
```

Add the failing test to `tests/server/handlers/practice.test.ts`:
```ts
  it('remove a sala e a memoria do bot quando o humano sai', async () => {
    const HOST = '22222222-2222-2222-2222-222222222222'
    const { socket, emit } = fakeSocket(HOST)
    registerLobbyHandlers(io, socket)
    const { roomId } = await emit('room:create-practice', { hostId: '00000000-0000-0000-0000-000000000000', hostName: 'Eu', bots: 2, level: 'easy' })
    await emit('room:leave', { roomId, playerId: HOST })
    expect(await lobby.getRoom(roomId)).toBeUndefined()
    expect(await lobby.getBotMemory(roomId, `bot:${roomId}:0`)).toBeUndefined()
  })
```

- [ ] **Step 7: Run handler test + full suite + tsc** — Run: `cd bate-backend && npx vitest run tests/server/handlers/practice.test.ts && npx vitest run && npx tsc --noEmit` → PASS, clean.

- [ ] **Step 8: Commit** — `git commit -m "add room:create-practice handler, bot broadcast trigger and round cleanup"`

---

### Task 11: e2e — practice room reaches round-end (local-only)

**Files:**
- Create: `bate-backend/tests/e2e/bot-treino.test.ts`

**Interfaces:** Consumes the running server over real sockets (helpers in `tests/e2e/helpers.ts`). Uses a fresh port **3097** (3098/3099 taken) and short bot think times.

- [ ] **Step 1: Allow short think times in the driver** — in `driver.ts` `pickThinkMs`, honor an env override:
```ts
const envMs = Number(process.env.BOT_THINK_MS_OVERRIDE)
if (Number.isFinite(envMs) && envMs >= 0) return envMs
```
(place at the top of `pickThinkMs`). Document `BOT_THINK_MS_OVERRIDE` in the backend README env table.

- [ ] **Step 2: Write the e2e (self-skipping)** — copy the spawn/`waitForHealth`/group-kill skeleton **verbatim** from `tests/e2e/ghost-seat.test.ts`, changing `PORT = 3097`, adding `BOT_THINK_MS_OVERRIDE: '20'` to the spawn `env`, then:
```ts
run('TREINO: humano vs bots', () => {
  it('cria sala de treino com 2 bots e a rodada avanca ate round-end', async () => {
    const { playerId, cookie } = await guestSession(BASE)
    const socket = await connect(BASE, cookie)
    const reached = waitForRoomState(socket, s => s.phase === 'round-end' || s.phase === 'match-end', 30000)
    const { roomId } = await emitAck(socket, 'room:create-practice', { hostId: playerId, hostName: 'Eu', bots: 2, level: 'hard' })
    expect(roomId).toBeTruthy()
    await emitAck(socket, 'game:initial-peek-done', { roomId, playerId })
    const { state } = await reached
    expect(['round-end', 'match-end']).toContain(state.phase)
    socket.close()
  }, 35000)
})
```
(Match the exact helper import block of `ghost-seat.test.ts`; `waitForRoomState` must be registered before the emit, per `helpers.ts`.)

- [ ] **Step 3: Run it locally** — Run: `cd bate-backend && pnpm test:e2e` → the suite spawns its own server and the practice test passes. (It self-skips in normal `vitest run`/CI because `TEST_E2E` is unset.)

- [ ] **Step 4: Commit** — `git commit -m "add local e2e for practice-room bot flow"`

---

### Task 12: Frontend — practice entry point + dialog

**Files:**
- Create: `bate-frontend/src/components/lobby/PracticeRoomDialog.tsx`
- Modify: `bate-frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `ensureSocketConnected`, `cachedPlayerId`, the `room:create-practice` socket event (Task 10).
- Produces: `PracticeRoomDialog`, lobby button.

- [ ] **Step 1: Create `PracticeRoomDialog.tsx`** — mirror `CreateRoomDialog`'s shell/segmented-button style; state `bots: 1|2|3` and `level: BotLevel`:
```tsx
'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { ensureSocketConnected } from '@/lib/socket-client'
import { cachedPlayerId } from '@/lib/auth'
import type { BotLevel } from '@/types/shared'

const LEVELS: { id: BotLevel; label: string }[] = [
  { id: 'easy', label: 'FÁCIL' }, { id: 'medium', label: 'MÉDIO' }, { id: 'hard', label: 'DIFÍCIL' },
]

export function PracticeRoomDialog({ hostName, onCreated, onClose }: { hostName: string; onCreated: (roomId: string) => void; onClose: () => void }) {
  const [bots, setBots] = useState<1 | 2 | 3>(1)
  const [level, setLevel] = useState<BotLevel>('medium')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    setSubmitting(true)
    try {
      const socket = await ensureSocketConnected()
      const hostId = cachedPlayerId()
      if (!hostId) { toast.error('Sessão ainda não pronta — tenta de novo'); setSubmitting(false); return }
      socket.emit('room:create-practice', { hostId, hostName, bots, level }, (res: { roomId?: string; error?: string }) => {
        setSubmitting(false)
        if (res?.error) { toast.error(`Erro: ${res.error}`); return }
        if (res?.roomId) onCreated(res.roomId)
      })
    } catch (err) {
      setSubmitting(false)
      toast.error('Falha ao conectar')
      console.error('[create-practice]', err)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-bate-cream rounded-2xl p-7 w-full max-w-md border-[4px] border-bate-ink shadow-hard-lg" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl text-bate-red mb-6">TREINAR COM BOTS</h3>
        <p className="font-body text-sm text-bate-ink/70 mb-2">Quantos bots</p>
        <div className="flex gap-2 mb-5">
          {([1, 2, 3] as const).map(n => (
            <button key={n} onClick={() => setBots(n)} className={`flex-1 py-3 rounded-xl font-display border-[3px] border-bate-ink ${bots === n ? 'bg-bate-gold text-bate-ink shadow-hard-sm' : 'bg-bate-paper text-bate-ink/60'}`}>{n}</button>
          ))}
        </div>
        <p className="font-body text-sm text-bate-ink/70 mb-2">Dificuldade</p>
        <div className="flex gap-2 mb-6">
          {LEVELS.map(l => (
            <button key={l.id} onClick={() => setLevel(l.id)} className={`flex-1 py-3 rounded-xl font-display border-[3px] border-bate-ink text-sm ${level === l.id ? 'bg-bate-gold text-bate-ink shadow-hard-sm' : 'bg-bate-paper text-bate-ink/60'}`}>{l.label}</button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-bate-paper border-[3px] border-bate-ink text-bate-ink font-display shadow-hard-sm hover:scale-[1.02] transition-transform">CANCELAR</button>
          <button onClick={submit} disabled={submitting} className="flex-1 py-3 rounded-xl bg-bate-red text-bate-paper border-[3px] border-bate-ink font-display shadow-hard-sm hover:scale-[1.02] transition-transform disabled:opacity-50">{submitting ? 'CRIANDO…' : 'JOGAR'}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `page.tsx`** — add state + guard + render next to the existing `CreateRoomDialog` plumbing:
```tsx
const [showPractice, setShowPractice] = useState(false)
function openPractice() { if (!requireName()) return; setShowPractice(true) }
function handlePracticeCreated(roomId: string) { setShowPractice(false); handleJoin(roomId) }
// in the name-card <section>, next to the "Entrar na Sala"/create buttons:
<button onClick={openPractice} className="w-full py-3 rounded-xl bg-bate-green text-bate-paper border-[3px] border-bate-ink font-display shadow-hard-sm hover:scale-[1.02] transition-transform">🤖 TREINAR COM BOTS</button>
// near the CreateRoomDialog render:
{showPractice && <PracticeRoomDialog hostName={name} onCreated={handlePracticeCreated} onClose={() => setShowPractice(false)} />}
```
Import `PracticeRoomDialog`. (`handleJoin` already emits `room:join` + `router.push`; the human is the host of the practice room, so the join path works.)

- [ ] **Step 3: Verify** — Run: `cd bate-frontend && npx tsc --noEmit && pnpm build` → no type errors; `next build` succeeds (keep any `useSearchParams` inside the existing `<Suspense>`). Manual: `pnpm dev` (with backend running), click "TREINAR COM BOTS", pick 2 bots / Difícil, confirm a game starts and bots play.

- [ ] **Step 4: Commit** — `cd bate-frontend && git commit -m "add practice-vs-bots dialog and lobby entry point"`

---

### Task 13: Frontend — bot badge + WaitingRoom auto-start handling

**Files:**
- Modify: `bate-frontend/src/components/room2d/Nameplate.tsx`
- Modify: `bate-frontend/src/components/room2d/OpponentArea.tsx`
- Modify: `bate-frontend/src/components/room/WaitingRoom.tsx`

**Interfaces:**
- Consumes: `RedactedPlayer.isBot` (Task 1 mirror).
- Produces: bot badge UI; WaitingRoom practice handling.

- [ ] **Step 1: Add `isBot` to `Nameplate`** — add `isBot?: boolean` to `Props` and the destructure, and render a badge in the name row next to `👑`/`🏆`:
```tsx
{isBot && <span title="Bot" className="text-[12px]">🤖</span>}
```
Also treat bots as present so they aren't dimmed/"Desconectado": where `connected` drives opacity/the red dot, use `connected || isBot`.

- [ ] **Step 2: Pass `isBot` from `OpponentArea`** — desktop branch: add `isBot={player.isBot}` to the `<Nameplate .../>` call. Mobile pill (which inlines Avatar+name, no Nameplate): add `{player.isBot && <span title="Bot" className="text-[10px]">🤖</span>}` next to `{player.name}`, and use `player.connected || player.isBot` for the dim/red-dot conditions.

- [ ] **Step 3: Handle practice rooms in `WaitingRoom`** — compute `const isPractice = state.players.some(p => p.isBot)`. When `isPractice`, hide the host start/“aguarde jogadores” block (lines ~82-92) since the room auto-starts; and in the player list, render bots as `🤖`/ONLINE instead of OFFLINE (bots have `socketId: null`). Practice rooms normally skip WaitingRoom entirely, so this is a defensive fix.

- [ ] **Step 4: Verify** — Run: `cd bate-frontend && npx tsc --noEmit && pnpm build` → clean. Manual: start a practice game and confirm opponents show 🤖 on both desktop and mobile widths and are not shown as “Desconectado”.

- [ ] **Step 5: Commit** — `cd bate-frontend && git commit -m "show bot badge in-room and handle auto-started practice rooms"`

---

## Verification (run before opening the staging→main PR)

GitHub CI only runs on PRs to `main` (a `staging` PR runs **nothing**), and CI runs **only** `tsc --noEmit` + `vitest run` + `pnpm audit`. So verify locally:

```bash
# backend
cd bate-backend
npx tsc --noEmit          # expect: no errors (baseline is 0)
npx vitest run            # expect: all green; e2e self-skips
pnpm test:e2e             # expect: practice e2e green (spawns its own server)
pnpm test:redis           # optional: needs local redis on :6379 — verifies RedisStorage bot memory

# frontend
cd ../bate-frontend
npx tsc --noEmit          # expect: no errors
pnpm build                # expect: next build succeeds (watch useSearchParams/Suspense)
```

---

## Self-Review notes (resolved during planning)

- **Spec coverage:** every spec section maps to a task — types (T1), belief/anti-cheat (T2), 4 decisions (T3-T6), driver+orchestrator (T7,T9), storage (T8), handler+lifecycle+broadcast trigger (T10), tests incl. bot-vs-bot (T7) and e2e (T11), frontend dialog+badge+WaitingRoom (T12-T13). YAGNI cuts (fill-seat, minimax, stats) intentionally have no tasks.
- **Spec corrections folded in:** deck is 108 cards → `UNKNOWN_CARD_EV ≈ 5.33` (T1); `BotMemory` is array-based, not a `Set` (T2/T8); `finishRound`/`startRound` are pure → cleanup wired in `game-handlers.ts` (T10); the "≥1 human connected" guard uses the live-socket check, not `player.connected` (T9); `callBate` needs phase exactly `playing` and `swapAndDiscard` always triggers the old card's effect (T7); `scheduleBotActions` is `setTimeout`-only to avoid the `withRoomLock` deadlock (T9); tsc baseline is 0, not 42 (Global Constraints).
- **Type consistency:** the Shared Interfaces block is the single source for every cross-task name (`BotMemory`, `BotView`, `EffectInput`, `TurnDecision`, `PlannedAction`, `LEVEL_CONFIG`, storage signatures).
- **Adversarial review (3 lenses) folded in:** e2e `connect` now awaited and `waitForRoomState` result destructured as `{ state }` (T11); `decideTurn` special-cases a negative-value drawn card so the easy bot never discards a K/JOKER even with an all-unknown hand (T3); private practice rooms are torn down explicitly in `leaveRoom` when only bots remain — the idle sweep never visits private rooms, so the spec's "idle sweep expira a sala" was false (T10 Step 6b); the driver unit test mocks `broadcastRoom` to avoid the Task-10 recursion (T9); dead `discards`/`recordDiscard` removed (hard-level discard tracking cut to YAGNI — difficulty still separates via `memoryTurns`/`snapAccuracy`/`bateThreshold`/`thinkMs`); removed the bogus "tsc flags unused imports" hedges (`noUnusedLocals` is off).
