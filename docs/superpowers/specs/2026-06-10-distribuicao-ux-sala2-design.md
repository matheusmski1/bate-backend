# Spec — Distribuição (UX-1) + Assento Fantasma (SALA-2)

**Data:** 2026-06-10 · **Repos:** bate-backend + bate-frontend · **Branch:** `feat/invite-flow-ghost-seat` (nos dois)
**Origem:** BATINHO-BACKLOG.md → UX-1 (inteiro) + SALA-2 + a checagem de colisão do SALA-7.

## Problema

1. **SALA-2 (assento fantasma):** navegação SPA mantém o socket singleton vivo e `join`ado na sala. Sair de uma sala em `waiting` pelo "voltar" do browser não emite `room:leave` → o disconnect handler nunca dispara → o jogador fica `connected:true` segurando vaga até o idle sweep (~5min). Se o host inicia, o fantasma recebe cartas e queima o turn-timer. (Tab-close já é coberto: socket morre → disconnect → grace → `removePlayer`.)
2. **UX-1 (distribuição):** o core loop é "chamar amigo no Discord", mas:
   - `room/[roomId]/page.tsx:32-36` faz `if (!name) router.push('/')` → **descarta o roomId**; convidado sem apelido vira bounce sem rastro da sala.
   - `WaitingRoom.tsx:25` mostra só `Código: <roomId>` em texto plano; zero clipboard.
   - Sem campo "tenho um código" no lobby; `listRooms` expõe toda sala → não dá pra jogar de fato privado com amigos (Quick Play entra em qualquer sala em `waiting`).

## Decisões (aprovadas)

- **SALA-2 = guards server-side + botão explícito** (não emitir `room:leave` no cleanup do effect — frágil: o cleanup dispara em mudança de `[roomId, router, setRoom, isSpectator]` e 2× no StrictMode).
- **Sala privada default desligada** + toggle no create (mantém lobby vivo e Quick Play funcionando; Quick Play sempre cria pública).
- **Colisão do SALA-7 entra** (barato; o join-by-code digitado justifica). Alfabeto **fica hex** — `randomUUID().slice(0,6)` já não gera `O/I/L`, sem ambiguidade real.
- **Spec/plan vivem no bate-backend** (`~/projects` não é repo git).

## Escopo

| Sub-item | Tipo | Repo |
|---|---|---|
| SALA-2 — guards `lobby:subscribe` + `room:join`, `leaveRoom` extraído, botão de sair na WaitingRoom | bug | ambos |
| UX-1.A — copiar convite (clipboard + share) | feature S | front |
| UX-1.B — fix do bounce → auto-join via `?join=` | bug | front |
| UX-1.C1 — campo "tenho um código" no lobby | feature S | front |
| UX-1.C2 — salas privadas (flag `private` filtrada nos 2 storages) | feature M | back + front |
| SALA-7 (parte) — `createRoom` collision-safe | bug S | back |

## Desenho — Backend

### Tipos compartilhados
- `src/types/shared.ts` (**os dois repos**, md5 hoje igual): `GameState` ganha `private: boolean`. `RedactedState = Omit<GameState,'players'|'deck'> & {...}` **carrega `private` de graça**. `RoomSummary` **não muda** (sala privada nem é resumida).

### Schema + input
- `handlers/schemas.ts`: `RoomCreateSchema` += `private: z.boolean().optional()`.
- `storage/types.ts` `CreateRoomInput` e `game/state.ts` `CreateRoomInput` (local) += `private?: boolean`.
- `game/state.ts` `createEmptyRoom`: `private: input.private ?? false`.

### Salas privadas — filtragem
- **memory.ts** `listRooms`: `Array.from(this.rooms.values()).filter(s => !s.private).map(summarize)`.
- **redis.ts** `persist`: `if (!state.private) multi.hSet(SUMMARIES_KEY, state.roomId, JSON.stringify(summarize(state)))`. `ROOM_KEY` + deadline (ZSET) continuam gravados → join por código/convite e turn-timer funcionam. `removeRoom` já dá `hDel`.

### Colisão de roomId (SALA-7)
- Extrair helper puro **testável**: `generateUniqueRoomId(exists: (id: string) => boolean | Promise<boolean>): string` com retry (até 5). `createRoom` (memória **e** redis) usa o helper com seu predicado de existência (`this.rooms.has` / `await this.getRoom`). Janela de corrida residual no Redis é desprezível (espaço 16,7M + retry); documentar.

### SALA-2 — `leaveRoom` extraído + guards
- Extrair de `lobby-handlers.ts` (handler `room:leave` atual, linhas ~183-228) uma função reusável:
  `async function leaveRoom(io, socket, roomId, playerId): Promise<void>` — contém o `withRoomLock` (pending → spectator → in-game → `removePlayer`), `socket.leave`, `releaseSocket`, **`clearPlayerRoom(playerId)`** (o handler atual não limpa → deixa índice stale; o connection handler auto-cura, mas limpar na saída é mais correto), `broadcastRoom` se sobrou sala, e `lobby:update`. O handler `room:leave` passa a chamar essa função.
- **Guard `lobby:subscribe`:** `const pid = socket.data.playerId; const rid = await lobby.getPlayerRoom(pid)`; se `rid` existe e a sala está em `waiting`/`round-end` e o player está em `players` → `await leaveRoom(io, socket, rid, pid)` **antes** do `listRooms`. (Em `playing` **não** sai — deixa grace/disconnect; jogador pode voltar.)
- **Guard `room:join`:** antes de bindar na sala B, `const prev = await lobby.getPlayerRoom(payload.playerId)`; se `prev && prev !== payload.roomId` e `prev` está em `waiting`/`round-end` com o player dentro → `await leaveRoom(io, socket, prev, payload.playerId)`. Lock de `prev` e de B são sequenciais (não aninhados) → sem deadlock.

## Desenho — Frontend

- `src/types/shared.ts`: espelhar `GameState.private` (manter md5 sync com o back).
- `app/room/[roomId]/page.tsx`: bounce vira `router.replace('/?join=' + roomId + (isSpectator ? '&spectate=1' : ''))` (preserva intenção de assistir).
- `app/page.tsx`:
  - Ler `?join` (e `?spectate`) do `useSearchParams`. Banner "Entrando na sala XYZ — bota teu apelido"; focar input. Ao confirmar apelido (espera `ensureGuestSession`), chamar `handleJoin(roomId)` / `handleSpectate` já existentes.
  - Campo "tenho um código": input uppercase → `handleJoin(code)`. `ROOM_NOT_FOUND` → toast amigável ("Essa mesa não existe ou já fechou").
- `components/room/WaitingRoom.tsx`:
  - Botão "COPIAR CONVITE": `navigator.clipboard.writeText(\`${location.origin}/room/${state.roomId}\`)` + `navigator.share` no mobile (feature-detect) → toast "Convite copiado!". Estilo `border-[3px] border-bate-ink shadow-hard-sm`.
  - Botão de sair (`LeaveButton` reusado ou inline) → `room:leave` + `router.push('/')`.
  - Selo "🔒 PRIVADA" quando `state.private`. (Bônus: mascote de `public/batinho/` nos slots vazios.)
- `components/lobby/CreateRoomDialog.tsx`: toggle "🔒 Sala privada (só por convite)" (default off) → incluir `private` no emit `room:create`.

## Testes

**Backend (Vitest — TDD):**
- `tests/server/storage/storage-contract.test.ts` (estender o harness `runStorageContract`, roda em Memory **e** Redis via `test:redis`):
  - sala `private` **não** aparece em `listRooms`, mas `getRoom(roomId)` a recupera.
  - `createRoom` nunca sobrescreve sala existente (ids únicos em N criações).
- `generateUniqueRoomId`: unit test direto do retry (predicado `exists` que devolve true nas 2 primeiras → 3ª id sai).
- `leaveRoom` + guards: unit test com `MemoryStorage` + fake `io`/`socket` (espelhar o estilo de `tests/server/lobby.test.ts`): após guard de `lobby:subscribe`/`room:join`, jogador sai da sala antiga; afirmar nenhum `connected:true` órfão e `getPlayerRoom` reapontado.

**Frontend (sem runner — Playwright MCP / manual):**
- Link `/room/XYZ` sem apelido → cai em `/?join=XYZ`, digita apelido → entra na sala XYZ (não bounce).
- Copiar convite escreve no clipboard.
- Campo de código entra na sala; código inválido → toast amigável.
- Sala criada como privada **não** aparece em SALAS ABERTAS, mas é alcançável por código.
- WaitingRoom: botão de sair some o assento (host re-eleito, sala segue).

## Fora de escopo (não tocar agora)

SALA-3 (espectador que senta vê tudo), SALA-5 (kick + eleição de fantasma), troca de alfabeto do roomId, ghost de **espectador** em SPA-nav (só o assento de player entra), mapa completo de microcopy de erro (UX-8), montar runner de teste no frontend.

## Sequência de implementação

1. **Backend tipos + schema + private** (state/types/schema/shared) → contract test verde.
2. **createRoom collision-safe** (`generateUniqueRoomId`) → unit + contract verde.
3. **`leaveRoom` extraído + guards** (lobby:subscribe, room:join) → handler test verde.
4. **Frontend tipos + bounce fix + auto-join `?join=`**.
5. **Frontend join-by-code + WaitingRoom (copiar/sair/selo) + CreateRoomDialog toggle**.
6. **Verificação Playwright** + atualizar BATINHO-BACKLOG.md.
