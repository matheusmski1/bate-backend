# Invite Flow + Ghost-Seat Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invite links work end-to-end (copy, join-by-code, private rooms) and eliminate the ghost seat left when a player navigates away from a waiting room via SPA.

**Architecture:** Backend (Vitest/TDD) adds a `private` flag filtered from the lobby, collision-safe room ids, and a reusable `leaveRoom` invoked by two server-side guards (`lobby:subscribe`, `room:join`) so SPA navigation can't strand a seat. Frontend (no test runner → Playwright/manual verify) fixes the bounce into an auto-join flow, adds a join-by-code field, a copy-invite + leave button in the waiting room, and a private toggle on create.

**Tech Stack:** Node + Socket.io + TypeScript (backend, Vitest), Next.js + React + Tailwind (frontend), Redis/Memory storage parity via contract tests.

**Spec:** `docs/superpowers/specs/2026-06-10-distribuicao-ux-sala2-design.md`

**Repos:** `bate-backend` and `bate-frontend`, both on branch `feat/invite-flow-ghost-seat`. Paths below are relative to each repo root; the repo is named in each Files block.

**Run backend tests:** `cd bate-backend && npx vitest run <path>` (Memory only) or `npm run test:redis` (Memory + Redis). E2E: `TEST_E2E=1 npx vitest run tests/e2e/<file>`.

---

## Task 1: `private` flag plumbed and filtered from the lobby

**Files:**
- Modify: `bate-backend/src/types/shared.ts:90` (GameState)
- Modify: `bate-frontend/src/types/shared.ts` (GameState — mirror, keep md5 sync)
- Modify: `bate-backend/src/server/handlers/schemas.ts:10-16` (RoomCreateSchema)
- Modify: `bate-backend/src/server/storage/types.ts:7-15` (CreateRoomInput)
- Modify: `bate-backend/src/server/game/state.ts:8-17,32-57` (local CreateRoomInput + createEmptyRoom)
- Modify: `bate-backend/src/server/storage/memory.ts:118-120` (listRooms filter)
- Modify: `bate-backend/src/server/storage/redis.ts:92-105` (persist skip/del summary)
- Test: `bate-backend/tests/server/storage/storage-contract.test.ts`

- [ ] **Step 1: Write the failing test** — add inside `runStorageContract`, after the existing `'lista salas com resumo'` test (`bate-backend/tests/server/storage/storage-contract.test.ts:73`):

```ts
    it('nao lista sala privada mas a recupera por id', async () => {
      const aberta = await storage.createRoom(createInput())
      const secreta = await storage.createRoom({ ...createInput(), private: true })

      const listadas = (await storage.listRooms()).map(r => r.roomId)
      expect(listadas).toContain(aberta.roomId)
      expect(listadas).not.toContain(secreta.roomId)

      const recuperada = await storage.getRoom(secreta.roomId)
      expect(recuperada?.roomId).toBe(secreta.roomId)
      expect(recuperada?.private).toBe(true)
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bate-backend && npx vitest run tests/server/storage/storage-contract.test.ts -t "sala privada"`
Expected: FAIL — TS error `'private' does not exist in type 'CreateRoomInput'` (or the room is listed).

- [ ] **Step 3: Add the type + schema + default + filters**

`bate-backend/src/types/shared.ts` — add as the last field of `GameState` (after `spectators: Spectator[]`):

```ts
  spectators: Spectator[]
  private?: boolean
}
```

`bate-frontend/src/types/shared.ts` — make the identical edit to its `GameState` (same `spectators` line).

`bate-backend/src/server/handlers/schemas.ts` — `RoomCreateSchema`:

```ts
export const RoomCreateSchema = z.object({
  name: z.string().min(1).max(40),
  hostId: playerId,
  hostName: playerName,
  maxPlayers: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  turnTimeLimitSec: z.number().int().min(0).max(600).nullable().optional(),
  private: z.boolean().optional(),
})
```

`bate-backend/src/server/storage/types.ts` — `CreateRoomInput`:

```ts
export type CreateRoomInput = {
  name: string
  hostId: string
  hostName: string
  maxPlayers: 2 | 3 | 4
  turnTimeLimitSec?: number | null
  deck?: string
  arena?: string
  private?: boolean
}
```

`bate-backend/src/server/game/state.ts` — local `CreateRoomInput` (line 8) add `private?: boolean` the same way, and in the `createEmptyRoom` return object add after `spectators: []`:

```ts
    spectators: [],
    private: input.private ?? false,
  }
```

`bate-backend/src/server/storage/memory.ts` — `listRooms`:

```ts
  async listRooms(): Promise<RoomSummary[]> {
    return Array.from(this.rooms.values()).filter(s => !s.private).map(summarize)
  }
```

`bate-backend/src/server/storage/redis.ts` — in `persist`, replace line 97 (`multi.hSet(SUMMARIES_KEY, ...)`) with:

```ts
      if (state.private) {
        multi.hDel(SUMMARIES_KEY, state.roomId)
      } else {
        multi.hSet(SUMMARIES_KEY, state.roomId, JSON.stringify(summarize(state)))
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bate-backend && npx vitest run tests/server/storage/storage-contract.test.ts` (and `npm run test:redis` if a local Redis is up).
Expected: PASS (Memory; Redis suite if `TEST_REDIS_URL` set).

- [ ] **Step 5: Commit**

```bash
cd bate-backend && git add src/types/shared.ts src/server/handlers/schemas.ts src/server/storage/types.ts src/server/game/state.ts src/server/storage/memory.ts src/server/storage/redis.ts tests/server/storage/storage-contract.test.ts
git commit -m "feat: add private room flag filtered from lobby listing"
cd ../bate-frontend && git add src/types/shared.ts && git commit -m "feat: mirror private room flag in shared types"
```

---

## Task 2: Collision-safe room id generation (SALA-7)

**Files:**
- Create: `bate-backend/src/server/storage/room-id.ts`
- Modify: `bate-backend/src/server/storage/memory.ts:9-11,35-40` (drop local `generateRoomId`, use helper)
- Modify: `bate-backend/src/server/storage/redis.ts:9-11,107-112` (drop local `generateRoomId`, use helper)
- Test: `bate-backend/tests/server/storage/room-id.test.ts` (new) + add a uniqueness case to the contract test

- [ ] **Step 1: Write the failing test** — create `bate-backend/tests/server/storage/room-id.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { generateUniqueRoomId } from '@/server/storage/room-id'

describe('generateUniqueRoomId', () => {
  it('retorna o primeiro id livre no formato esperado', async () => {
    const id = await generateUniqueRoomId(() => false)
    expect(id).toMatch(/^[0-9A-F]{6}$/)
  })

  it('tenta de novo enquanto o id ja existe', async () => {
    let chamadas = 0
    const id = await generateUniqueRoomId(() => {
      chamadas++
      return chamadas <= 2
    })
    expect(chamadas).toBe(3)
    expect(id).toMatch(/^[0-9A-F]{6}$/)
  })

  it('desiste depois de maxAttempts', async () => {
    await expect(generateUniqueRoomId(() => true, 3)).rejects.toThrow('ROOM_ID_GENERATION_FAILED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bate-backend && npx vitest run tests/server/storage/room-id.test.ts`
Expected: FAIL — `Cannot find module '@/server/storage/room-id'`.

- [ ] **Step 3: Create the helper** — `bate-backend/src/server/storage/room-id.ts`:

```ts
import { randomUUID } from 'node:crypto'

export function generateRoomId(): string {
  return randomUUID().slice(0, 6).toUpperCase()
}

export async function generateUniqueRoomId(
  exists: (id: string) => boolean | Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generateRoomId()
    if (!(await exists(id))) return id
  }
  throw new Error('ROOM_ID_GENERATION_FAILED')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bate-backend && npx vitest run tests/server/storage/room-id.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the helper into both storages**

`bate-backend/src/server/storage/memory.ts` — delete the local `generateRoomId` (lines 9-11), add to the imports block `import { generateUniqueRoomId } from './room-id'`, and change `createRoom`:

```ts
  async createRoom(input: CreateRoomInput): Promise<GameState> {
    const roomId = await generateUniqueRoomId(id => this.rooms.has(id))
    const state = createEmptyRoom({ roomId, ...input })
    this.rooms.set(roomId, state)
    return state
  }
```

`bate-backend/src/server/storage/redis.ts` — delete the local `generateRoomId` (lines 9-11), add `import { generateUniqueRoomId } from './room-id'`, and change `createRoom`:

```ts
  async createRoom(input: CreateRoomInput): Promise<GameState> {
    const roomId = await generateUniqueRoomId(async id => (await this.getRoom(id)) !== undefined)
    const state = createEmptyRoom({ roomId, ...input })
    await this.persist(state)
    return state
  }
```

- [ ] **Step 6: Add a uniqueness case to the contract test** — in `bate-backend/tests/server/storage/storage-contract.test.ts`, after the new private test:

```ts
    it('createRoom nunca colide ids', async () => {
      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) ids.add((await storage.createRoom(createInput())).roomId)
      expect(ids.size).toBe(50)
    })
```

- [ ] **Step 7: Run full storage suite and commit**

Run: `cd bate-backend && npx vitest run tests/server/storage/`
Expected: PASS.

```bash
cd bate-backend && git add src/server/storage/room-id.ts src/server/storage/memory.ts src/server/storage/redis.ts tests/server/storage/room-id.test.ts tests/server/storage/storage-contract.test.ts
git commit -m "fix: make room id generation collision-safe"
```

---

## Task 3: Extract `leaveRoom` from the `room:leave` handler (refactor + clearPlayerRoom)

This is a behavior-preserving refactor guarded by a characterization e2e test. It enables the guards in Tasks 4-5.

**Files:**
- Create: `bate-backend/tests/e2e/helpers.ts`
- Create: `bate-backend/tests/e2e/ghost-seat.test.ts`
- Modify: `bate-backend/src/server/handlers/lobby-handlers.ts:183-228` (extract `leaveRoom`, handler calls it, add `clearPlayerRoom`)

- [ ] **Step 1: Create shared e2e helpers** — `bate-backend/tests/e2e/helpers.ts`:

```ts
import { io, type Socket } from 'socket.io-client'

export const PORT_BASE = 3090
export const ORIGIN = 'http://localhost:3000'
export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function waitForHealth(base: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await delay(500)
  }
  throw new Error('server nao subiu')
}

export async function guestSession(base: string): Promise<{ playerId: string; cookie: string }> {
  const res = await fetch(`${base}/auth/guest`)
  const body = (await res.json()) as { playerId: string }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  const cookie = (setCookies[0] ?? '').split(';')[0] ?? ''
  return { playerId: body.playerId, cookie }
}

export function connect(base: string, cookie: string): Promise<Socket> {
  const socket = io(base, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Cookie: cookie, Origin: ORIGIN },
  })
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 8000)
    socket.once('connect', () => { clearTimeout(t); resolve(socket) })
    socket.once('connect_error', err => { clearTimeout(t); reject(err) })
  })
}

export function emitAck(socket: Socket, event: string, payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000)
    socket.emit(event, payload, (res: unknown) => { clearTimeout(t); resolve(res) })
  })
}

export function waitForEvent(socket: Socket, event: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`evento "${event}" nao chegou em ${timeoutMs}ms`)), timeoutMs)
    socket.once(event, (payload: unknown) => { clearTimeout(t); resolve(payload) })
  })
}
```

- [ ] **Step 2: Write the characterization test** — `bate-backend/tests/e2e/ghost-seat.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { openSync } from 'node:fs'
import { connect, guestSession, emitAck, waitForEvent, waitForHealth, delay, ORIGIN } from './helpers'

const PORT = 3098
const BASE = `http://localhost:${PORT}`
const run = process.env.TEST_E2E ? describe : describe.skip

run('SALA-2: assento fantasma', () => {
  let server: ChildProcess

  beforeAll(async () => {
    const logFd = openSync('/tmp/e2e-ghost.log', 'w')
    server = spawn('npx', ['tsx', 'src/server/index.ts'], {
      env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'info', NODE_ENV: 'test', DATABASE_URL: '', REDIS_URL: '' },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    })
    await waitForHealth(BASE)
  }, 40000)

  afterAll(() => {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGKILL') } catch { /* group gone */ }
    }
  })

  async function roomWithGuest() {
    const host = await guestSession(BASE)
    const hostSocket = await connect(BASE, host.cookie)
    const created = await emitAck(hostSocket, 'room:create', {
      name: 'ghost', hostId: host.playerId, hostName: 'Host', maxPlayers: 4, turnTimeLimitSec: 600,
    })
    const roomId = created.roomId as string
    await emitAck(hostSocket, 'room:join', { roomId, playerId: host.playerId, playerName: 'Host' })
    const guest = await guestSession(BASE)
    const guestSocket = await connect(BASE, guest.cookie)
    await emitAck(guestSocket, 'room:join', { roomId, playerId: guest.playerId, playerName: 'Guest' })
    return { host, hostSocket, guest, guestSocket, roomId }
  }

  it('room:leave explicito em waiting remove o assento', async () => {
    const { hostSocket, guest, guestSocket, roomId } = await roomWithGuest()
    const left = waitForEvent(hostSocket, 'room:state', 4000)
    await emitAck(guestSocket, 'room:leave', { roomId, playerId: guest.playerId })
    const payload = await left
    expect(payload.state.players.some((p: { name: string }) => p.name === 'Guest')).toBe(false)
    hostSocket.disconnect(); guestSocket.disconnect()
    await delay(100)
  }, 25000)
})
```

- [ ] **Step 3: Run it to verify it passes (baseline, pre-refactor)**

Run: `cd bate-backend && TEST_E2E=1 npx vitest run tests/e2e/ghost-seat.test.ts`
Expected: PASS — current `room:leave` already removes the seat. This locks the behavior before refactoring.

- [ ] **Step 4: Extract `leaveRoom` and call it from the handler** — in `bate-backend/src/server/handlers/lobby-handlers.ts`, add this module-level function above `registerLobbyHandlers` (the body is the current handler's lock block + side effects, plus `clearPlayerRoom`):

```ts
export async function leaveRoom(io: SocketServer, socket: Socket, roomId: string, playerId: string): Promise<void> {
  const result = await lobby.withRoomLock(roomId, async () => {
    const room = await lobby.getRoom(roomId)
    if (!room) return null
    const isPending = (room.pendingJoins ?? []).some(p => p.id === playerId)
    if (isPending) {
      const next = {
        ...room,
        pendingJoins: room.pendingJoins.filter(p => p.id !== playerId),
        spectators: (room.spectators ?? []).filter(s => s.id !== playerId),
      }
      await lobby.setRoom(next)
      return next
    }
    const isSpectator = (room.spectators ?? []).some(s => s.id === playerId)
    if (isSpectator) {
      const next = { ...room, spectators: (room.spectators ?? []).filter(s => s.id !== playerId) }
      await lobby.setRoom(next)
      return next
    }
    const inGame = room.phase !== 'waiting' && room.phase !== 'round-end' && room.phase !== 'match-end'
    if (inGame) {
      const adjusted = removePlayerMidGame(room, playerId)
      await lobby.setRoom(adjusted)
      if (adjusted.players.length === 0) {
        await lobby.removeRoom(roomId)
        return null
      }
      return adjusted
    }
    return (await lobby.removePlayer(roomId, playerId)) ?? null
  })
  socket.leave(roomId)
  await lobby.releaseSocket(socket.id)
  await lobby.clearPlayerRoom(playerId)
  if (result) broadcastRoom(io, result)
  io.to('lobby').emit('lobby:update', { rooms: await lobby.listRooms() })
  console.log(`[room:leave] socket=${socket.id} player=${playerId} room=${roomId}`)
}
```

Then replace the body of the `socket.on('room:leave', ...)` handler (lines ~183-228) with a thin wrapper:

```ts
  socket.on('room:leave', async (raw: unknown, ack: (res: { ok?: true; error?: string }) => void) => {
    const payload = parseAndAuth(RoomLeaveSchema, raw, ack, socket)
    if (!payload) return
    try {
      await leaveRoom(io, socket, payload.roomId, payload.playerId)
      ack({ ok: true })
    } catch (err) {
      ack({ error: err instanceof Error ? err.message : 'UNKNOWN' })
    }
  })
```

- [ ] **Step 5: Re-run the characterization test + full handler suite**

Run: `cd bate-backend && TEST_E2E=1 npx vitest run tests/e2e/ghost-seat.test.ts && npx vitest run tests/server/lobby.test.ts`
Expected: PASS (behavior unchanged).

- [ ] **Step 6: Commit**

```bash
cd bate-backend && git add tests/e2e/helpers.ts tests/e2e/ghost-seat.test.ts src/server/handlers/lobby-handlers.ts
git commit -m "refactor: extract reusable leaveRoom and clear player-room index on leave"
```

---

## Task 4: `room:join` guard — leave the previous waiting room first

**Files:**
- Modify: `bate-backend/src/server/handlers/lobby-handlers.ts` (inside `room:join`, before binding)
- Test: `bate-backend/tests/e2e/ghost-seat.test.ts`

- [ ] **Step 1: Write the failing test** — add inside the `run('SALA-2: ...')` block:

```ts
  it('entrar noutra sala em waiting libera o assento da anterior', async () => {
    const { hostSocket, guest, guestSocket, roomId: roomA } = await roomWithGuest()

    // host de uma 2a sala
    const host2 = await guestSession(BASE)
    const host2Socket = await connect(BASE, host2.cookie)
    const created2 = await emitAck(host2Socket, 'room:create', {
      name: 'sala-b', hostId: host2.playerId, hostName: 'Host2', maxPlayers: 4, turnTimeLimitSec: 600,
    })
    const roomB = created2.roomId as string
    await emitAck(host2Socket, 'room:join', { roomId: roomB, playerId: host2.playerId, playerName: 'Host2' })

    // guest, ainda "fantasma" na sala A, entra na sala B
    const leftA = waitForEvent(hostSocket, 'room:state', 4000)
    await emitAck(guestSocket, 'room:join', { roomId: roomB, playerId: guest.playerId, playerName: 'Guest' })
    const stateA = await leftA
    expect(stateA.state.players.some((p: { name: string }) => p.name === 'Guest')).toBe(false)

    hostSocket.disconnect(); guestSocket.disconnect(); host2Socket.disconnect()
    await delay(100)
  }, 25000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bate-backend && TEST_E2E=1 npx vitest run tests/e2e/ghost-seat.test.ts -t "noutra sala"`
Expected: FAIL — `room:state` from room A never arrives (the seat stays), timeout.

- [ ] **Step 3: Add the guard** — in `bate-backend/src/server/handlers/lobby-handlers.ts`, at the top of the `room:join` handler's `try` block (right after `if (!payload) return` and before `const [deck, arena] = ...`):

```ts
    try {
      const previousRoomId = await lobby.getPlayerRoom(payload.playerId)
      if (previousRoomId && previousRoomId !== payload.roomId) {
        const previousRoom = await lobby.getRoom(previousRoomId)
        const leftBehind = previousRoom
          && (previousRoom.phase === 'waiting' || previousRoom.phase === 'round-end')
          && previousRoom.players.some(p => p.id === payload.playerId)
        if (leftBehind) await leaveRoom(io, socket, previousRoomId, payload.playerId)
      }
      const [deck, arena] = await Promise.all([lookupDeck(payload.playerId), lookupArena(payload.playerId)])
```

(`leaveRoom` is already defined in this module from Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bate-backend && TEST_E2E=1 npx vitest run tests/e2e/ghost-seat.test.ts`
Expected: PASS (all ghost-seat cases).

- [ ] **Step 5: Commit**

```bash
cd bate-backend && git add src/server/handlers/lobby-handlers.ts tests/e2e/ghost-seat.test.ts
git commit -m "fix: leave stale waiting room when joining another (ghost seat)"
```

---

## Task 5: `lobby:subscribe` guard — leave the waiting room when returning to the lobby

**Files:**
- Modify: `bate-backend/src/server/handlers/lobby-handlers.ts:44-47` (`lobby:subscribe`)
- Test: `bate-backend/tests/e2e/ghost-seat.test.ts`

- [ ] **Step 1: Write the failing test** — add inside the `run('SALA-2: ...')` block:

```ts
  it('voltar pro lobby (lobby:subscribe) libera o assento em waiting', async () => {
    const { hostSocket, guestSocket } = await roomWithGuest()
    const left = waitForEvent(hostSocket, 'room:state', 4000)
    guestSocket.emit('lobby:subscribe')
    const payload = await left
    expect(payload.state.players.some((p: { name: string }) => p.name === 'Guest')).toBe(false)
    hostSocket.disconnect(); guestSocket.disconnect()
    await delay(100)
  }, 25000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bate-backend && TEST_E2E=1 npx vitest run tests/e2e/ghost-seat.test.ts -t "lobby:subscribe"`
Expected: FAIL — host never receives the `room:state` removing Guest, timeout.

- [ ] **Step 3: Add the guard** — replace the `lobby:subscribe` handler in `bate-backend/src/server/handlers/lobby-handlers.ts`:

```ts
  socket.on('lobby:subscribe', async () => {
    const playerId = (socket.data as { playerId?: string } | undefined)?.playerId
    if (playerId) {
      const currentRoomId = await lobby.getPlayerRoom(playerId)
      if (currentRoomId) {
        const room = await lobby.getRoom(currentRoomId)
        const stillSeated = room
          && (room.phase === 'waiting' || room.phase === 'round-end')
          && room.players.some(p => p.id === playerId)
        if (stillSeated) await leaveRoom(io, socket, currentRoomId, playerId)
      }
    }
    socket.join('lobby')
    socket.emit('lobby:update', { rooms: await lobby.listRooms() })
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bate-backend && TEST_E2E=1 npx vitest run tests/e2e/ghost-seat.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the whole backend suite (regression) and commit**

Run: `cd bate-backend && npx vitest run && TEST_E2E=1 npx vitest run tests/e2e/`
Expected: PASS.

```bash
cd bate-backend && git add src/server/handlers/lobby-handlers.ts tests/e2e/ghost-seat.test.ts
git commit -m "fix: leave waiting room when returning to lobby (ghost seat)"
```

---

## Task 6: Frontend — mirror types already done; fix the invite bounce into a redirect

> Frontend has no test runner. Each frontend task ends with a Playwright/manual verification step instead of an automated test. Type changes are checked with `npx tsc --noEmit` (or `npm run build`).

**Files:**
- Modify: `bate-frontend/src/app/room/[roomId]/page.tsx:31-36`

- [ ] **Step 1: Replace the bounce** — in `bate-frontend/src/app/room/[roomId]/page.tsx`, change the no-name branch inside the effect:

```ts
  useEffect(() => {
    const name = getStoredName()
    if (!name) {
      const params = new URLSearchParams({ join: roomId })
      if (isSpectator) params.set('spectate', '1')
      router.replace(`/?${params.toString()}`)
      return
    }
```

- [ ] **Step 2: Type-check**

Run: `cd bate-frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd bate-frontend && git add src/app/room/[roomId]/page.tsx
git commit -m "fix: redirect nameless invite visitor to lobby preserving room id"
```

(Verification happens together with Task 7, since the lobby must consume `?join`.)

---

## Task 7: Frontend — lobby consumes `?join` (auto-join) and adds a join-by-code field

**Files:**
- Modify: `bate-frontend/src/app/page.tsx`

- [ ] **Step 1: Read `?join`/`?spectate` and auto-join after a name is set** — in `bate-frontend/src/app/page.tsx`, add `useSearchParams` to the imports from `next/navigation`, then inside `Home()` add:

```ts
  const search = useSearchParams()
  const joinParam = search.get('join')?.toUpperCase() ?? ''
  const joinSpectate = search.get('spectate') === '1'
  const [code, setCode] = useState('')

  useEffect(() => {
    if (!joinParam) return
    if (!getStoredName()) { inputRef.current?.focus(); return }
    if (joinSpectate) handleSpectate(joinParam)
    else handleJoin(joinParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinParam, joinSpectate])
```

- [ ] **Step 2: Make the name submit honor a pending `?join`** — change the name input's `onKeyDown` (currently `if (e.key === 'Enter' && name.trim()) handleQuickPlay()`):

```ts
                onKeyDown={e => {
                  if (e.key !== 'Enter' || !name.trim()) return
                  if (joinParam) { setStoredName(name); joinSpectate ? handleSpectate(joinParam) : handleJoin(joinParam) }
                  else handleQuickPlay()
                }}
```

- [ ] **Step 3: Add the join-by-code field + a banner when arriving via invite** — directly below the "Entrar na Sala" button block (after the closing `</button>` of `handleQuickPlay`, still inside the same card `<div className="flex flex-col gap-5">`):

```tsx
            {joinParam ? (
              <p className="text-center font-display text-sm text-bate-ink/70">
                Convite pra sala <span className="font-mono text-bate-ink">{joinParam}</span> — bota teu apelido pra entrar
              </p>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  onKeyDown={e => { if (e.key === 'Enter' && code.trim()) handleJoin(code.trim()) }}
                  placeholder="TENHO UM CÓDIGO"
                  maxLength={12}
                  autoComplete="off"
                  className="flex-1 bg-bate-cream border-[3px] border-bate-ink shadow-hard-sm rounded-xl h-12 px-4 font-mono font-bold tracking-widest placeholder-bate-ink/40 focus:outline-none uppercase"
                />
                <button
                  type="button"
                  onClick={() => { if (code.trim()) handleJoin(code.trim()) }}
                  className="px-4 h-12 rounded-xl bg-bate-paper border-[3px] border-bate-ink shadow-hard-sm font-display text-sm text-bate-ink hover:bg-bate-gold transition-colors"
                >
                  ENTRAR
                </button>
              </div>
            )}
```

- [ ] **Step 4: Friendly error for an unknown code** — `handleJoin` already does `toast.error(\`Erro: ${res.error}\`)`. Replace that single line inside `handleJoin` with a small map:

```ts
        if (res?.error) {
          const friendly: Record<string, string> = {
            ROOM_NOT_FOUND: 'Essa mesa não existe ou já fechou',
            ROOM_FULL: 'Mesa lotada, parça',
          }
          toast.error(friendly[res.error] ?? `Erro: ${res.error}`)
          return
        }
```

- [ ] **Step 5: Type-check**

Run: `cd bate-frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Verify the invite bounce + code join (Playwright/manual)**

Start backend (`cd bate-backend && npm run dev`) and frontend (`cd bate-frontend && npm run dev`). Then:
1. Open the app, create a room, copy its code (or read it from the URL `/room/CODE`).
2. In a fresh incognito window (no stored name), open `/room/CODE` → assert you land on `/?join=CODE` with the "Convite pra sala CODE" banner, not an empty lobby.
3. Type a nickname, press Enter → assert you enter room CODE (URL `/room/CODE`, you appear in the player list).
4. Back in the lobby with a name set, type a bogus code in "TENHO UM CÓDIGO" → assert toast "Essa mesa não existe ou já fechou".

- [ ] **Step 7: Commit**

```bash
cd bate-frontend && git add src/app/page.tsx
git commit -m "feat: auto-join via invite link and add join-by-code field"
```

---

## Task 8: Frontend — WaitingRoom copy-invite + leave button + private badge

**Files:**
- Modify: `bate-frontend/src/components/room/WaitingRoom.tsx`

- [ ] **Step 1: Add copy-invite, leave, and a private badge** — rewrite `bate-frontend/src/components/room/WaitingRoom.tsx` adding the imports and UI (keep the existing player list and start button):

Add to the imports:

```ts
import { useRouter } from 'next/navigation'
import { LogOut, Copy } from 'lucide-react'
```

Inside the component, after `const canStart = ...`:

```ts
  const router = useRouter()

  async function copyInvite() {
    const url = `${location.origin}/room/${state.roomId}`
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Batinho', text: 'Bora jogar Batinho?', url })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Convite copiado!')
      }
    } catch { toast.error('Não rolou copiar — copia da barra de endereço') }
  }

  function leave() {
    getSocket().emit('room:leave', { roomId: state.roomId, playerId }, () => router.push('/'))
  }
```

Replace the `Código: <roomId>` paragraph (line 24-26) with the code row + private badge:

```tsx
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <p className="text-bate-ink/70 font-body">
            Código: <span className="text-bate-ink font-mono font-bold">{state.roomId}</span>
          </p>
          {state.private && (
            <span className="font-display text-xs px-2 py-1 rounded-md bg-bate-ink text-bate-paper">🔒 PRIVADA</span>
          )}
          <button
            type="button"
            onClick={copyInvite}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-bate-gold border-[3px] border-bate-ink shadow-hard-sm font-display text-sm text-bate-ink hover:scale-105 transition-transform"
          >
            <Copy size={14} strokeWidth={3} /> COPIAR CONVITE
          </button>
        </div>
```

Add a leave button at the top-right of the card (right after the opening card `<div className="bg-bate-paper ...">`):

```tsx
        <button
          type="button"
          onClick={leave}
          title="Sair da sala"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-bate-paper border-[2px] border-bate-ink shadow-hard-sm flex items-center justify-center text-bate-ink hover:bg-bate-red hover:text-bate-paper transition-colors"
        >
          <LogOut size={14} strokeWidth={3} />
        </button>
```

(Make the card `<div>` `relative`: change `className="bg-bate-paper rounded-3xl p-8 ..."` to include `relative`.)

Confirm `toast` from `@/lib/ui-store` exposes `success`; if not, use `toast.info`.

- [ ] **Step 2: Type-check**

Run: `cd bate-frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify (Playwright/manual)**

With both servers running and a room open in waiting:
1. Click COPIAR CONVITE → assert toast "Convite copiado!" (desktop) and that the clipboard holds `/room/CODE`.
2. Click the leave (LogOut) button → assert you return to `/` and a second browser viewing the room sees your seat disappear.
3. Create a room with the private toggle (Task 9) on → assert the 🔒 PRIVADA badge shows.

- [ ] **Step 4: Commit**

```bash
cd bate-frontend && git add src/components/room/WaitingRoom.tsx
git commit -m "feat: add copy-invite, leave button and private badge to waiting room"
```

---

## Task 9: Frontend — private toggle on CreateRoomDialog

**Files:**
- Modify: `bate-frontend/src/components/lobby/CreateRoomDialog.tsx`

- [ ] **Step 1: Add the toggle state and send `private`** — in `bate-frontend/src/components/lobby/CreateRoomDialog.tsx`, add to the component state:

```ts
  const [isPrivate, setIsPrivate] = useState(false)
```

In the `room:create` emit payload, add `private: isPrivate`:

```ts
        { name: name.trim(), hostId, hostName, maxPlayers, turnTimeLimitSec, private: isPrivate },
```

Add the toggle control in the dialog body (next to the maxPlayers / turn-limit controls — match their styling):

```tsx
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="font-display text-sm text-bate-ink">🔒 Sala privada (só por convite)</span>
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={e => setIsPrivate(e.target.checked)}
            className="w-5 h-5 accent-bate-red"
          />
        </label>
```

- [ ] **Step 2: Type-check**

Run: `cd bate-frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify (Playwright/manual)**

1. Create a room with the toggle ON. In a second browser, open the lobby → assert the room is NOT in "SALAS ABERTAS".
2. Copy the private room's code, use the "TENHO UM CÓDIGO" field in the second browser → assert you can still join it.
3. Create a room with the toggle OFF → assert it appears in "SALAS ABERTAS".

- [ ] **Step 4: Commit**

```bash
cd bate-frontend && git add src/components/lobby/CreateRoomDialog.tsx
git commit -m "feat: add private room toggle to create dialog"
```

---

## Task 10: End-to-end verification + backlog update

**Files:**
- Modify: `~/projects/BATINHO-BACKLOG.md`

- [ ] **Step 1: Full backend regression**

Run: `cd bate-backend && npx vitest run && TEST_E2E=1 npx vitest run tests/e2e/`
Expected: PASS. (Run `npm run test:redis` too if a local Redis is available, to confirm storage parity.)

- [ ] **Step 2: Playwright sweep of the full invite flow** — with both dev servers running, drive via the Playwright MCP:
  1. Nameless visitor hits `/room/CODE` → lands on `/?join=CODE`, enters name, joins.
  2. Copy invite writes the URL.
  3. Join-by-code works; bogus code shows friendly toast.
  4. Private room hidden from lobby, reachable by code.
  5. Leave from WaitingRoom + return-to-lobby + join-another-room all drop the seat (cross-check with `/health/dashboard`: no `connected:true` orphan whose socketId is absent from `io.sockets.sockets`).

- [ ] **Step 3: Tick the backlog** — in `~/projects/BATINHO-BACKLOG.md`, mark the executive-summary rows and the item checkboxes for **SALA-2**, **UX-1**, and the collision part of **SALA-7** as done (e.g. `- [x]`), with a short note pointing to branch `feat/invite-flow-ghost-seat`. Leave SALA-7's alphabet bullet and the `drawnCache` roomId bullet unchecked (out of scope).

- [ ] **Step 4: Commit the backlog update** (note: `~/projects` is not a git repo — this is a plain file edit, no commit there). Then push both feature branches when the user asks.

---

## Self-review notes

- **Spec coverage:** UX-1.A (Task 8), UX-1.B (Tasks 6-7), UX-1.C1 (Task 7), UX-1.C2 (Tasks 1, 9), SALA-2 (Tasks 3-5 + 8 leave button), SALA-7 collision (Task 2). All covered.
- **Out of scope (unchecked in backlog):** SALA-3, SALA-5, roomId alphabet, spectator ghost on SPA-nav, full UX-8 microcopy map, frontend test harness.
- **Type consistency:** `leaveRoom(io, socket, roomId, playerId)` signature is identical in Tasks 3/4/5. `generateUniqueRoomId(exists, maxAttempts?)` identical in Task 2 usages. `private?: boolean` consistent across shared.ts (both repos), both `CreateRoomInput`s, schema, and `createEmptyRoom`.
- **Frontend caveat:** no test runner — Tasks 6-9 rely on `tsc --noEmit` + Playwright/manual verification, called out explicitly per task.
