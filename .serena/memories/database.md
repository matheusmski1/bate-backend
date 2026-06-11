## Banco (TypeORM/Postgres) — bate-backend

`src/server/db/`:
- `data-source.ts` — `AppDataSource`. `synchronize:false` (sempre via migration), `migrationsTableName:'typeorm_migrations'`, SSL ligado em prod (`rejectUnauthorized:false`) salvo `DATABASE_SSL=false`. Logging via `DATABASE_LOG=true`. `DATABASE_URL` obrigatório em prod.
- `entities/` — `User`, `Deck`, `UserDeck`, `Arena`, `UserArena` (cosméticos/conta; o estado de jogo vive no `mem:storage`, não no Postgres).
- `migrations/` — ordenadas por timestamp; `run-migrations.ts` roda no boot de prod (`pnpm start`).
- `seed.ts` / `seed-decks.ts` / `seed-arenas.ts`; helpers `users.ts`, `decks.ts`, `arenas.ts`.

Fluxo de mudança de schema: editar entity → `pnpm migration:generate src/server/db/migrations/<Nome>` → revisar → `pnpm migration:run`. Nunca ligar `synchronize`.
