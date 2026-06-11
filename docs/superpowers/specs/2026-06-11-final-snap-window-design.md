# Janela viva de corte no fim do bate

**Data:** 2026-06-11
**Repo:** bate-backend (+ bate-frontend)
**Status:** aprovado (brainstorming)
**Substitui:** a pausa de revelação congelada (PR #15 / spec `2026-06-11-round-end-reveal-pause`)

## Problema

Quando a última ação da sequência de bate fecha a rodada, o engine finaliza **na hora** (`advanceTurn`/`advanceTurnExported` calculam o score e setam `round-end` no mesmo passo). Isso fecha a janela de corte: `snapCard` só aceita `playing`/`bate-called`, então qualquer corte fora-de-turno depois da ação final dá `INVALID_PHASE`.

**Cenário real (do usuário):** jogador com 2 Áses, compra um -3 e **troca** (swap) o -3 por um Ás → o Ás vai pro topo do descarte. O jogador ainda tem o **outro Ás** e poderia cortar (match com o topo) pra esvaziar mais a mão e baixar o score. Mas o swap era a última ação do bate → a rodada finalizou antes → o corte foi negado.

A pausa do PR #15 é só **visual** (o estado já é `round-end`, score travado), então não resolve: durante a pausa ninguém corta de verdade.

## Decisão

Transformar o fim da sequência de bate numa **janela viva**: em vez de finalizar, o servidor entra numa fase de tabuleiro onde o corte ainda funciona, e só **finaliza (calcula score + `round-end`) quando a janela fecha**. Como cortar reduz a mão, o score precisa ser calculado no **fechamento** (com as mãos atuais), não na ação.

**Fechamento: estende a cada corte.** Base ~2.5s; cada corte certo reinicia pra ~2s; fecha no primeiro respiro sem corte. Escolhido porque o snap no Batinho é uma ação contínua (sem janelas discretas mid-round), então "tempo fixo" cortaria jogadas legítimas — viola o objetivo ("deixar o jogador fazer todas as ações possíveis"). É auto-limitado: só corte **certo** estende, e cartas que casam com o topo são finitas.

### Escopo

A janela viva cobre **a transição de ação→fim pela sequência de bate** (`turnsRemaining` chega a 0 em `advanceTurn`/`advanceTurnExported`), incluindo quando isso vira `match-end`. **Fora de escopo:** fim por deck-vazio (`endRoundEmptyDeck`) finaliza direto como hoje — evita recursão (corte errado com deck vazio chama `endRoundEmptyDeck` de novo) e é raro. Efeitos de carta (trocar/espiar/olhar) **já resolvem** no turno antes do fim — confirmado por trace; serão blindados com teste de regressão, não precisam de mudança.

Isto **substitui** o mecanismo congelado do PR #15 (`boardRevealSnapshot` + `scheduleEndReveal` + `broadcastEndAware`): o benefício visual de "ver a última jogada" continua de graça porque o tabuleiro fica vivo durante a janela.

## Componentes

### 1. Engine — `game/state.ts` e `game/engine.ts`

**`finalizeRound(state): GameState` (puro, novo em `game/engine.ts`)** — extrai o que hoje está inline em `advanceTurn`/`advanceTurnExported`/`endRoundEmptyDeck`:
```
players com score += scoreHand(hand); phase = isMatchEnd ? 'match-end' : 'round-end';
snapWindow = null; log += entrada 'round-end'
```
Única fonte de cálculo de score + fase de fim.

**`openFinalSnapWindow(state): GameState` (puro, novo em `game/engine.ts`)** — quando `turnsRemaining` chega a 0:
```
phase = 'final-snap'; turnsRemaining = 0; turnDeadlineAt = null;
snapWindow = { openedAt: Date.now(), durationMs: FINAL_SNAP_WINDOW_MS, discardedCardId: <id do topo do descarte> }
```
SEM calcular score. `advanceTurn`/`advanceTurnExported` passam a chamar `openFinalSnapWindow` no lugar do bloco que hoje calcula score e seta `round-end`.

**Nova fase `'final-snap'`** em `GamePhase` (`types/shared.ts`, espelhar no front). É fase de tabuleiro: incluída em `isBoardPhase`; **não** em `isEndPhase`; **não** entra no `revealAll` da redação (mãos seguem escondidas).

**`snapCard`**: adicionar `'final-snap'` às fases aceitas (hoje `playing`/`bate-called`). Corte na janela funciona normalmente. Corte que esvazia a mão com bate já chamado só esvazia (melhor score).

### 2. Casca de IO — `handlers/final-snap.ts` (evolui `end-reveal.ts`)

**Registro de timers por sala:** `Map<roomId, NodeJS.Timeout>`. Agendar limpa o timer anterior da sala; finalizar/remover sala limpa também.

**`scheduleRoundFinalize(io, roomId, expectedRoundNumber, delayMs)`** — agenda `setTimeout`. No disparo (async protegido por `.catch(log.error)`): trava a sala (`withRoomLock`); se a sala sumiu ou não está mais em `final-snap` ou `roundNumber` mudou → ignora; senão `finalizeRound`, persiste, `broadcastRoom` (agora `round-end`/`match-end` → revela mãos → RoundEndScreen).

**`openAndScheduleFinalize(io, next, delayMs)`** — substitui `broadcastEndAware`: persiste o estado `final-snap`, `broadcastRoom` (tabuleiro, mãos escondidas), agenda o finalize. Chamada pelos handlers de ação no lugar de `broadcastRoom` quando `next.phase === 'final-snap'`.

`boardRevealSnapshot`, `scheduleEndReveal`, `broadcastEndAware` do PR #15 são **removidos** (substituídos).

### 3. Handlers — `handlers/game-handlers.ts`

- Nos 5 handlers de ação (`draw`, `keep-or-discard`, `snap`, `skip-effect`, `effect-target`): se `next.phase === 'final-snap'` → `openAndScheduleFinalize(io, next, FINAL_SNAP_WINDOW_MS)`; senão `broadcastRoom(io, next)`.
- **Corte na janela estende:** no handler `game:snap`, se o estado pré era `final-snap` e o corte foi **certo** (mão diminuiu / log `snap`), reagenda o finalize com `FINAL_SNAP_EXTEND_MS` e atualiza `snapWindow.openedAt`/`durationMs` no estado. Corte errado não estende.

### 4. Config

`FINAL_SNAP_WINDOW_MS` (default 2500, base) e `FINAL_SNAP_EXTEND_MS` (default 2000, reset por corte), no padrão `Number(process.env.X ?? default)`. Substitui `ROUND_END_REVEAL_MS`.

### 5. Frontend — `bate-frontend`

- `'final-snap'` adicionada ao `GamePhase` espelhado e ao seletor de view → renderiza `GameArea` (tabuleiro) com corte habilitado.
- Banner de contagem regressiva "ÚLTIMO CORTE!" usando `snapWindow.openedAt + durationMs`.
- Garantir que a UI de corte fica ativa em `final-snap` (mesma de `playing`/`bate-called`).

## Fluxo (cenário do usuário)

```
swap final (último turno do bate) → advanceTurn: turnsRemaining→0
  → openFinalSnapWindow: phase 'final-snap', snapWindow aberto, SEM score
  → handler persiste + broadcastRoom (tabuleiro, Ás no topo) + scheduleRoundFinalize(+2.5s)
  → jogador corta o 2º Ás → snapCard ok → mão diminui
       → handler reagenda finalize (+2s) + atualiza snapWindow
  → respiro sem corte → finalize dispara
       → finalizeRound: score com a mão ATUAL (sem o Ás cortado), phase round-end
       → broadcastRoom (revela mãos) → RoundEndScreen
```

## Edge cases

- **Reconexão na janela:** recebe `final-snap`, pode cortar. Melhor que antes.
- **Corte errado na janela:** puxa penalidade (se deck tem carta), **não** estende. Se deck vazio → `endRoundEmptyDeck` finaliza direto (fora do timer; aceitável).
- **Match-end pelo bate:** `finalizeRound` seta `match-end` se `isMatchEnd(scored)` → tela de fim de partida no fechamento.
- **AFK / todos caem na janela:** o finalize dispara no deadline de qualquer jeito → finaliza.
- **Sala removida na janela:** finalize re-busca, acha `null`, ignora; timer da sala é limpo na remoção.
- **Ações de turno na janela** (draw/discard): rejeitadas — os handlers exigem `playing`/`bate-called`, `final-snap` dá `INVALID_PHASE`. Só corte funciona.

## Testes

- **Unit (Vitest, puro):** `finalizeRound` (score + round/match-end + log); `openFinalSnapWindow` (fase, snapWindow, sem score); `snapCard` aceita `final-snap`; **regressão de efeito:** último turno do bate descarta carta de ação → resolve efeito antes do fim (blinda o que já funciona).
- **Unit do agendador:** `scheduleRoundFinalize` com fake timers + lobby mockado — finaliza no deadline, guard por `final-snap`/`roundNumber`, reagenda no corte, ignora sala removida.
- **e2e (`pnpm test:e2e`):** com `FINAL_SNAP_WINDOW_MS=80`, reproduz o cenário dos 2 Áses (montando o estado via storage no setup): última ação abre `final-snap`, o jogador corta o 2º Ás dentro da janela, e o `round-end` final reflete o score sem o Ás cortado.

## Arquivos tocados

- `src/types/shared.ts` (+ espelho no front): `'final-snap'` em `GamePhase`.
- `src/server/game/engine.ts`: `finalizeRound`, `openFinalSnapWindow`, `snapCard` aceita `final-snap`, `advanceTurn`/`advanceTurnExported` chamam `openFinalSnapWindow`.
- `src/server/game/state.ts`: `isBoardPhase` inclui `final-snap` (predicados do PR #15).
- `src/server/game/redact.ts`: confirmar que `final-snap` NÃO revela mãos.
- `src/server/handlers/final-snap.ts` (renomeia/evolui `end-reveal.ts`): registro de timers, `scheduleRoundFinalize`, `openAndScheduleFinalize`. Remove `boardRevealSnapshot`/`scheduleEndReveal`/`broadcastEndAware`.
- `src/server/handlers/game-handlers.ts`: integração + extensão no `game:snap`.
- Config env (`FINAL_SNAP_WINDOW_MS`, `FINAL_SNAP_EXTEND_MS`).
- `bate-frontend`: `GamePhase` espelho, seletor de view, banner de contagem, UI de corte em `final-snap`.
- Testes unit + e2e listados acima.
