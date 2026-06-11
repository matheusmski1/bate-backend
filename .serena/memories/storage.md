## Storage abstraction — bate-backend

`src/server/storage/` desacopla estado de sala/jogo do backend concreto:
- `types.ts` — interface `Storage` (contrato) + tipos `CreateRoomInput`, `JoinInput`, `SocketBinding`, `DrawnCacheEntry`.
- `index.ts` — singleton via `getStorage()`/`setStorage()`. Todo acesso a estado passa por aqui.
- `memory.ts` — `MemoryStorage`: dev single-process, estado em memória.
- `redis.ts` — `RedisStorage`: prod multi-process; coordena via Redis (locks + estado compartilhado). Necessário quando há réplicas (o pub/sub adapter do Socket.io em `index.ts` cuida da entrega de eventos entre processos).

Escolha do backend depende de `REDIS_URL`/ambiente. Ao adicionar operação de estado, estenda a interface `Storage` e implemente nos **dois** backends — caso contrário multi-process diverge do dev.
