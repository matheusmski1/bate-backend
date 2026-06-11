## Game engine — bate-backend

`src/server/game/` concentra a lógica pura do jogo (sem I/O de socket/db):
- `engine.ts` — operações que transformam `GameState`: `drawFromDeck`, `swapAndDiscard`, `discardDrawnCard`, `snapCard`/`closeSnapWindow`, `callBate`, `resolveEffect`/`skipEffect` (efeitos por rank via `effectFromRank`), `advanceTurn`/`autoPlayExpiredTurn`, timers (`startTurnTimer`/`pauseTimer`/`resumeTimer`/`withFreshTurnTimer`), `finishRound`/`endRoundEmptyDeck`/`removePlayerMidGame`. Consts: `MAX_HAND_SIZE`, `SNAP_WINDOW_MS`.
- `state.ts` — criação/transição de estado e fases. `GamePhase`: `waiting → initial-peek → playing → effect-pending → bate-called → round-end → match-end`.
- `deck.ts` — baralho/shuffle. `scoring.ts` — pontuação de fim de round. `redact.ts` — ver `mem:handlers`.

Efeitos (`EffectType`): `peek-own`, `peek-other`, `swap` — disparados por rank ao descartar.

Testes do engine em `tests/` (engine-bate, engine-draw, engine-effects, engine-snap, scoring, state, state-pending, redact). É o coração testado do produto — alterações aqui exigem rodar `pnpm test:run`.
