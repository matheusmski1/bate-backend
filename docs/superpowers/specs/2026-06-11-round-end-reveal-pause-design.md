# Pausa de revelação antes do fim de rodada

**Data:** 2026-06-11
**Repo:** bate-backend
**Status:** aprovado (brainstorming)

## Problema

Quando um jogador faz a ação que encerra a rodada — tipicamente o **bate** na última jogada, mas também deck-vazio e fim de partida — o engine aplica a ação **e** vira a fase pra `round-end`/`match-end` na MESMA atualização de estado (`engine.ts:312-316` no `advanceTurn`; `finishRound`). O handler dá **um único broadcast** já com a fase de fim, então o cliente troca direto pro `RoundEndScreen` e os outros jogadores **nunca veem a jogada final animar no tabuleiro**. Eles perdem o "o que aconteceu".

O `RoundEndScreen` já tem revelação encenada (estágios `analyzing`/`reveal` em 1.8s/3.6s), então o fim em si não é seco — o que falta é a **última jogada no tabuleiro**.

## Decisão

**Pausa no servidor (2 broadcasts).** Quando uma ação de jogador faz a fase virar fim, o servidor:

1. Persiste o estado de fim (fonte da verdade — correção/crash-safety).
2. Faz broadcast de um **snapshot de tabuleiro** com a jogada aplicada (todos veem animar como um turno normal, com redação correta de cartas).
3. Após `ROUND_END_REVEAL_MS` (default 2500ms), re-broadcast do estado de fim → `RoundEndScreen` assume.

A pausa é puramente visual; a fonte da verdade no storage é sempre o estado de fim.

### Por que servidor e não cliente

A alternativa (cliente segura o tabuleiro antes de trocar de tela) mantém o servidor puro, mas o payload de `round-end` **revela todas as mãos** (scoring) — animar a última jogada a partir dele vaza carta revelada antes da hora. O snapshot de tabuleiro do servidor é um estado de tabuleiro de verdade, com redação correta (mãos dos oponentes escondidas), e fica sincronizado entre todos os clientes. O preço é um `setTimeout` de re-broadcast, isolado num módulo.

## Componentes (3 peças isoladas)

### a) `boardRevealSnapshot(endState, prevPhase)` — puro, em `game/state.ts`

Deriva o snapshot de tabuleiro a partir do estado de fim:
- `phase` ← `prevPhase` (`bate-called` ou `playing`) → cliente renderiza `GameArea`, não `RoundEndScreen`
- `turnDeadlineAt: null` → sem timer correndo sobre a jogada congelada
- remove a entrada de log `round-end`/`match-end` do final do array (se presente) → a última entrada vira a ação real (descarte/draw/bate); o som de vitória só dispara quando o estado de fim real chegar

Função pura, sem timer, sem IO. Testável isoladamente.

### b) `scheduleEndReveal(io, roomId, expectedPhase, expectedRoundNumber, delayMs)` — novo `handlers/end-reveal.ts`

Encapsula a assincronia. Agenda `setTimeout(delayMs)` que:
- re-busca a sala; se sumiu → ignora (sala removida/expirada na janela)
- se `phase`/`roundNumber` atuais não baterem com o esperado → ignora (ex.: host chamou próxima rodada na janela — raríssimo em 2.5s; guard evita clobber)
- senão → `broadcastRoom(io, current)` do estado de fim persistido

### c) `broadcastEndAware(io, prevPhase, next)` — em `handlers/broadcast.ts`

Substitui `broadcastRoom(io, next)` nos handlers de ação onde a rodada pode acabar:
- se `prevPhase` é fase de tabuleiro **e** `next.phase` é fase de fim → broadcast de `boardRevealSnapshot(next, prevPhase)` + `scheduleEndReveal(...)`
- senão → `broadcastRoom(io, next)` (comportamento atual, inalterado)

Helpers de classificação: `isEndPhase(p)` = `p === 'round-end' || p === 'match-end'`; fase de tabuleiro = qualquer não-fim e não-`waiting`.

## Fluxo

```
ação final → engine retorna estado round-end/match-end
  → handler (dentro do withRoomLock) persiste o estado de fim        [fonte da verdade]
  → broadcastEndAware(io, room.phase, next):
       broadcast boardRevealSnapshot              → todos veem a jogada animar
       scheduleEndReveal(... , ROUND_END_REVEAL_MS)
  → ~2.5s depois: re-broadcast do estado de fim   → RoundEndScreen encena (já existe)
```

O handler já tem o estado pré-ação (`room`, lido dentro do lock), então `prevPhase = room.phase` está disponível sem mudança de assinatura do engine.

## Escopo

Vale pra **toda transição de ação-de-jogador → `round-end` ou `match-end`**: bate na última jogada (caso principal), deck-vazio (`finishRound`) e fim de partida. Mesma mecânica, mesma cura.

**Fora de escopo:** saída/desconexão que encerra a sala (`leaveRoom`, `removePlayerMidGame`) — não há jogada pra mostrar. Naturalmente excluído porque a detecção mora só nos handlers de ação (não nos de saída).

## Config & edge cases

- `ROUND_END_REVEAL_MS` (env, default `2500`) — segue o padrão de `ROOM_IDLE_MS`/`ROOM_CLEANUP_INTERVAL_MS`. Testes setam ~50ms.
- **Reconexão na janela:** join/reconnect recebe o estado de fim direto (pula a animação). Aceitável e raro.
- **Crash na janela:** cliente pega o estado de fim no reconnect (já persistido). Seguro.
- **Próxima rodada na janela:** guard por `expectedPhase`+`expectedRoundNumber` no `scheduleEndReveal` evita re-broadcast clobbering.
- **Jogador que bateu:** também recebe snapshot → fim. Vê a própria jogada animar. Consistente.
- **Sala removida na janela:** `scheduleEndReveal` re-busca e ignora se `null`.

## Testes

- **Unit (Vitest):** `boardRevealSnapshot` — fase volta pro tabuleiro, `turnDeadlineAt` nulo, entrada de log de fim removida, resto do estado intacto.
- **e2e (`pnpm test:e2e`):** com `ROUND_END_REVEAL_MS=50`, dirige um bate até a jogada final e afirma a sequência: o oponente recebe **primeiro** um `room:state` com fase de tabuleiro (a jogada) e **depois** um com `round-end`. Usa o helper `waitForRoomState` existente.

## Arquivos tocados

- `src/server/game/state.ts` — novo `boardRevealSnapshot` (puro)
- `src/server/handlers/end-reveal.ts` — novo `scheduleEndReveal`
- `src/server/handlers/broadcast.ts` — novo `broadcastEndAware` + helpers `isEndPhase`
- `src/server/handlers/game-handlers.ts` — trocar `broadcastRoom(io, next)` → `broadcastEndAware(io, room.phase, next)` nos pontos de ação que podem encerrar a rodada
- config de env (`ROUND_END_REVEAL_MS`) onde os outros timings moram
- `tests/server/game/board-reveal-snapshot.test.ts` (unit), `tests/e2e/round-end-reveal.test.ts` (e2e)
