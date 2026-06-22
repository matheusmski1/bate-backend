# CLAUDE.md — bate-backend (Batinho)

Servidor Node.js + Socket.io do **Batinho** (jogo de cartas online, família Golf/Cabo). Frontend separado em `bate-frontend`. *Princípios gerais e preferências estão no `~/.claude/CLAUDE.md` global — aqui só o institucional deste repo.*

## Stack
- Socket.io (eventos de jogo em tempo real), TypeScript strict (ESM), rodado via **tsx** (sem build step).
- Storage abstraction: `MemoryStorage` (single-process/dev) ou `RedisStorage` (multi-process/prod), atrás de `getStorage()`; `lobby` é pass-through burro pra storage.
- Vitest (`globals: false`), e2e por sockets reais.

## Arquitetura
- **Engine puro**: cada ação é `GameState → GameState` (`game/engine.ts`, `game/state.ts`, `game/scoring.ts`). Não tem I/O.
- Camadas: handlers (socket) → engine/storage. Redação por jogador em `game/redact.ts` (esconde mãos alheias; revela só `revealedToSelf`).
- Modo treino vs bots: `game/bot/*` (cérebro puro + driver). Specs/planos em `docs/superpowers/`.

## Comandos (gates)
- `pnpm test:run` (= `vitest run`) — roda tudo; e2e self-skip sem `TEST_E2E`. **É o que o CI roda.**
- `npx tsc --noEmit` (= `pnpm typecheck`) — **único gate estático**. Baseline = **0 erro** (o "42" de skills antigas está stale). `noUncheckedIndexedAccess` ligado.
- `pnpm test:e2e` (= `TEST_E2E=1 vitest run tests/e2e`) — spawna o próprio servidor via tsx (sem DB/Redis), porta fixa única por arquivo, kill por process-group. **Flaky sob carga sequencial** (ack timeout em `game:bate`) — passa isolado/no rerun. CI NÃO roda.
- `pnpm test:redis` — contrato de storage contra Redis local (`TEST_REDIS_URL`). CI NÃO roda.
- **NÃO existe lint nem build** (dev/start = tsx).

## CI
- `.github/workflows/ci.yml` dispara **só em push/PR pra `main`**: `tsc --noEmit` + `vitest run` + `pnpm audit`. PR pra `staging` **não roda nada** → verificar local antes do merge. NÃO roda e2e nem redis.

## Convenções
- Vitest `globals:false` → importar `{ describe, it, expect, vi, ... }` de 'vitest' explicitamente; source via alias `@`.
- Descrições de teste em PT-BR; sem comentários no código.
- `src/types/shared.ts` é **byte-idêntico** com o `bate-frontend` — editar nos dois.
- Schemas: zod; `parseAndAuth` **sobrescreve** `playerId`/`hostId` com o id do cookie autenticado (o ator é sempre humano).

## Gotchas (custaram bug)
- **Identidade por flag, não por string**: bot é `isBot:true` com id `bot:<roomId>:<n>` (NÃO uuid). Nunca fazer parse/`split(':')`/`startsWith('bot:')` — usar `p.isBot` e `players.find(p => p.id === x)`. Campos que recebem id de **outro** jogador (ex: `targetPlayerId`) devem aceitar uuid OU id de bot.
- **Salas `private:true` escapam do idle sweep** (excluídas dos summaries) → precisam de **teardown explícito** quando sobram só bots (`leaveRoom` e o grace de reconexão).
- **Bot nunca pode ser host**: a reescolha de host deve preferir humano conectado (`find(p => p.connected && !p.isBot)`) — bot host trava `game:start`/`game:next-round` (bot não emite).
- **`final-snap` só finaliza se alguém armar `scheduleRoundFinalize`** no caminho que abriu a janela (handler `game:snap`, bot-driver, turn-timer). Registry é idempotente (clear-before-set + guard de phase/roundNumber).
- **Turn-timer é o backstop** (sala nunca trava): ao mexer nele, não remover o auto-play que cobre turno travado. Pra bots, o driver deve ganhar do deadline (thinkMs ≪ turnTimeLimitSec).
