## Comandos — bate-backend

Sempre **pnpm** (lockfile é pnpm).

- `pnpm dev` — `tsx watch` do server, porta 3001 default.
- `pnpm test` — vitest watch. `pnpm test:run` — single run (use em CI/verificação).
- `pnpm typecheck` — `tsc --noEmit` (não há build; este é o gate de tipos).
- `pnpm start` — modo prod: roda migrations e sobe o server (usado pelo Railway).

### TypeORM (datasource em `src/server/db/data-source.ts`)
- `pnpm migration:generate src/server/db/migrations/<Nome>` — gera migration a partir do diff das entities.
- `pnpm migration:run` / `pnpm migration:revert`.
- `pnpm seed` — popula dados (também `seed-decks.ts`, `seed-arenas.ts`).

Darwin: utilitários de shell padrão (`git`, `ls`, `grep`) sem diferença relevante.
