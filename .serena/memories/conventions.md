## Convenções — bate-backend

- ESM estrito: imports com extensão quando necessário; `import type` para tipos. Alias `@/*` → `src/*` (configurado no tsconfig e no vitest resolve.alias).
- Domínio compartilhado vem de `src/types/shared.ts` — não duplicar tipos de jogo; estender lá.
- Engine = funções puras sobre `GameState` (sem socket/db dentro de `src/server/game/`). I/O fica em handlers/storage/db.
- Validação de entrada: Zod em `handlers/schemas.ts` — nada do cliente chega ao engine sem validar.
- Comentários: código auto-explicativo, sem comentários (preferência do dono). Descrições de teste em PT-BR.
- Auth: token JWT guest, cookie `bate_session` (TTL 30 dias). `JWT_SECRET` precisa de 32+ chars em prod (`auth.ts` lança senão).
- Logs estruturados via `logger.ts` (`log.info/warn/error` + `snapshot(state)`); broadcast/handlers usam `console.log` com prefixos `[broadcast]`/`[trace]`.

### Env vars
`PORT` (auto Railway), `CORS_ORIGIN`, `REDIS_URL`, `DATABASE_URL`, `JWT_SECRET`, `DATABASE_SSL`, `DATABASE_LOG`, `NODE_ENV`.
