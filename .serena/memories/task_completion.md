## Definition of done — bate-backend

Antes de considerar uma task pronta, rodar (pnpm):
1. `pnpm typecheck` — `tsc --noEmit`. Não há build; este é o único gate de tipos.
2. `pnpm test:run` — vitest single run (engine tem cobertura ampla; mudanças em `src/server/game/` quase sempre quebram/exigem teste).

Sem linter/formatter configurado no `package.json` (não há eslint/prettier scripts) — não inventar comandos.

Se mexeu em entity/schema do banco: gerar e revisar migration (`pnpm migration:generate ...`), nunca `synchronize`. Ver `mem:database`.
