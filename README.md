# bate-backend

Servidor Node.js + Socket.io pro **Bate** — jogo de cartas multiplayer brasileiro de memorização e dedução, releitura da família clássica "Golf" (domínio público) e de jogos como Rat-a-Tat Cat (Gamewright, 1995). Identidade visual, mascote Batinho, nomes de ações e sistema de pontuação são originais.

Frontend separado: https://github.com/matheusmski1/bate-frontend

## Stack
- Socket.io (real-time game events)
- TypeScript strict
- Storage abstraction: MemoryStorage (single-process dev) ou RedisStorage (multi-process prod)
- Vitest (72 testes do engine)

## Dev

```bash
pnpm install
pnpm dev   # porta 3001 default
```

## Test

```bash
pnpm test:run
```

## Deploy Railway

1. Conecta repo (auto-deploy on push) ou `railway up` via CLI
2. Railway lê `railway.json` automaticamente
3. Env vars:
   - `PORT` — auto-injetado
   - `CORS_ORIGIN` — URL do frontend (ex: `https://bate-frontend.vercel.app`)
   - `REDIS_URL` — auto-injetado se você adicionar Redis no projeto

## Multi-process

Pra escalar além de 1 processo, no Railway:
1. **+ New** → **Database** → **Add Redis**
2. Settings → **Replicas** → 2+

Cada réplica coordena via Redis (locks + pub/sub adapter).

## Endpoints

- `GET /health` → `{ ok, uptime, pid, redis }`
- `GET /` → texto plain "Bate backend OK"
- `/socket.io/*` → Socket.io endpoint
