## Socket handlers + broadcast — bate-backend

`src/server/handlers/`:
- `lobby-handlers.ts` / `game-handlers.ts` — `registerGameHandlers`/lobby registrados por conexão em `index.ts`. Delegam ao `lobby` (`src/server/lobby.ts`, fachada fina sobre `getStorage()`) e ao engine.
- `schemas.ts` — **todo** evento socket tem um schema Zod (`RoomCreateSchema`, `GameDrawSchema`, `GameSnapSchema`, etc.). Validar o payload antes de processar é regra; helpers de validação ligam ao `audit`.
- `broadcast.ts` — `broadcastRoom(io, state)` emite `room:state` **por jogador**, cada um recebendo um estado redigido.

### Invariante crítico de segurança
Cliente nunca recebe `GameState` cru. `redactStateForPlayer(state, viewerId, isSpectator?)` em `src/server/game/redact.ts` esconde cartas de mão dos outros (`RedactedCard` vira `{id, hidden:true}`) e o baralho. Qualquer novo caminho que emita estado pro cliente DEVE passar por redact — senão vaza a mão adversária.

Rate limit: `src/server/rate-limit.ts` — token bucket por `socketId+event`, limites por evento (`game:draw` mais restrito que o default); `consume()` antes de processar, `release()` no disconnect.
