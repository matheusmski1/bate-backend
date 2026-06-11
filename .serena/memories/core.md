## bate-backend — source map

Servidor real-time (Socket.io) do jogo de cartas **Bate/Batinho** (família Golf/Cabo, inspiração Rat-a-Tat Cat). Frontend é repo separado (`bate-frontend`, github.com/matheusmski1/bate-frontend). Identidade visual/nomes de ações/scoring são originais.

### Layout
- `src/types/shared.ts` — contrato de domínio compartilhado com o front: `Card`, `Rank`, `Suit`, `GamePhase`, `GameState`, `Player`, `PendingEffect`, `SnapWindow`, `RedactedState`/`RedactedCard`/`RedactedPlayer`, `RoomSummary`. Fonte da verdade dos tipos do jogo.
- `src/server/index.ts` — entrypoint: HTTP server (health/CORS manual), Socket.io setup, Redis pub/sub adapter, auth middleware (`io.use`), reconnect grace, turn-timer interval, idle-room cleanup, graceful shutdown.
- `src/server/game/` — engine puro do jogo. Ver `mem:game_engine`.
- `src/server/handlers/` — registro de eventos socket + broadcast. Ver `mem:handlers`.
- `src/server/storage/` — abstração de persistência de salas/estado. Ver `mem:storage`.
- `src/server/db/` — TypeORM + Postgres (users, decks, arenas). Ver `mem:database`.
- `src/server/auth.ts` — JWT guest + cookie de sessão. `src/server/rate-limit.ts` — token bucket por socket+evento. `src/server/audit.ts`, `src/server/logger.ts` — observabilidade.

### Invariantes do projeto
- ESM puro (`"type":"module"`), TS rodado direto via **tsx** (sem build step; `noEmit`). Alias `@/*` → `src/*`.
- **NUNCA** emitir `GameState` cru pro cliente — sempre redigir. Ver `mem:handlers`.
- Todo payload de evento socket é validado com Zod antes de tocar o engine (`src/server/handlers/schemas.ts`).

Mais: `mem:tech_stack`, `mem:conventions`, `mem:suggested_commands`, `mem:task_completion`.
