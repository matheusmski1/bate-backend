## Stack — bate-backend

- Runtime: Node `>=22`, ESM (`"type":"module"`). TS executado direto por **tsx** (`tsx watch` em dev, `tsx` em prod) — não há etapa de compilação/`dist`.
- Linguagem: TypeScript strict + `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`. `experimentalDecorators`/`emitDecoratorMetadata` ligados (exigência do TypeORM).
- Package manager: **pnpm** (`pnpm-lock.yaml`). Não usar npm/yarn.
- Real-time: `socket.io` v4 + `@socket.io/redis-adapter` (pub/sub entre réplicas).
- Persistência: `typeorm` + `pg` (Postgres). Cache/coordenação multi-processo: `redis` v5.
- Validação: `zod` v4. Auth: `jsonwebtoken` v9.
- Testes: **vitest** v4 (`globals:false` → importar `describe/it/expect` explicitamente; environment `node`; só `tests/**/*.test.ts`).
- Deploy: Railway (NIXPACKS), config em `railway.json`.
