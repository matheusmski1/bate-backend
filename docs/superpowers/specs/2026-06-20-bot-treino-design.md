# Modo treino — jogar contra bots

**Data:** 2026-06-20
**Repo:** bate-backend (+ bate-frontend)
**Status:** aprovado (brainstorming)

## Problema

Hoje o Batinho só existe como multiplayer: pra jogar é preciso ter outras pessoas numa sala. Isso mata a retenção de jogador novo (quer aprender o Bate sem a pressão de uma mesa real) e impede jogar a qualquer hora. Falta um **modo treino**: 1 humano contra 1–3 bots, sem depender de gente.

## Decisão

O bot vira um **jogador virtual no servidor**: um `Player` na sala com `socketId: null` e flag `isBot`. Um *bot driver* observa o estado e, quando é a vez de um bot (ou abre chance de corte), calcula a jogada e chama **as mesmas funções de engine que o handler do humano chama** (`drawFromDeck`, `swapAndDiscard`, `discardDrawnCard`, `snapCard`, `resolveEffect`, `callBate`) seguidas de `broadcast`.

Escolhido sobre "engine offline no cliente" porque o engine é **puro e server-authoritative** — o cenário ideal pra encaixar bot no servidor sem duplicar regra. Portar o engine pro front multiplicaria o *shared-type sync* já existente entre os dois repos e abriria risco de a regra do solo divergir da do multiplayer. Aqui o bot joga, por construção, pelas **mesmas regras** que o humano.

### Regra anti-trapaça (central)

O bot roda no servidor com o `GameState` **completo** (vê todas as mãos). Pra ser justo, ele só lê o rank de cartas que **legalmente** conheceria. A memória é uma lista de `{ cardId, rank, turn }` — **chaveada por `cardId`, não por slot** — que cresce só quando o bot faz ação de informação:

- início da rodada → semeia os ranks das cartas do `revealedToSelf` (as 2 iniciais, `state.ts:117`; o Fácil semeia só 1)
- jogou 10 (peek-own) → aprende +1 carta própria
- jogou J (peek-other) → aprende +1 carta de oponente
- jogou Q (swap) → o conhecimento segue a `cardId`: o bot continua sabendo o rank da carta que **deu** (agora na mão do oponente) e só sabe a que **pegou** se já tinha espiado ela. O engine retorna `revealed:[]` no swap, então não há aprendizado novo — coerente com o anti-trapaça.

Como o conhecimento é chaveado por `cardId`, ele **sobrevive a swaps e cortes automaticamente** (a carta carrega o que se sabe dela aonde for); cartas que saem de todas as mãos são podadas (`pruneAbsent`). O Fácil **esquece** ranks aprendidos há mais de N turnos (`decay`). A consulta `knownRank` devolve `null` pra qualquer carta não-aprendida (ou esquecida) — é assim que o anti-trapaça é garantido **por construção**: a visão que as decisões recebem nunca expõe um rank que o bot não conhece legalmente.

A memória vive num **store por sala** (espelhando o padrão `drawnCard` da interface `Storage`), **fora** do `GameState` redatado — nunca vaza pro cliente.

**Dificuldade = fidelidade do que ele lembra + reação + limiares. Nenhum nível lê carta escondida.**

| | Fácil | Médio | Difícil |
|---|---|---|---|
| Memória | esquece após ~2 turnos; semeia 1 das 2 iniciais | retém a rodada inteira | retém tudo (sem decay) |
| Snap | erra/ignora bastante | razoável | alto acerto |
| Bate | limiar frouxo, às vezes tarde | ok | limiar afiado |
| "Pensar" / reação | 1.5–2.5s | 1–1.5s | 0.5–1s |

### Valores de carta (definem o cérebro)

De `scoring.ts`: `A=1 … 10=10, J=11, Q=12, K=-3, JOKER=-6`. **K e JOKER são negativas** → cartas boas. Consequências diretas:
- a "carta alta conhecida" do bot é sempre **por valor** (`CARD_VALUES`), não por rank visual;
- o bot **nunca** troca/descarta um K ou JOKER conhecido;
- no `decide-bate`, cartas conhecidas contam exato; desconhecidas valem o **valor esperado do baralho** (constante derivada de `CARD_VALUES`, calculada uma vez).

### Escopo

**Dentro:** modo treino (1 humano + 1–3 bots, mesa de até 4), 3 níveis, cérebro heurístico, driver, store de memória, entrada no lobby. **Fora (YAGNI):**
- ❌ preencher sala multiplayer real com bots (o motor serve, mas exige driver em tick-loop por multi-process — fica pra depois)
- ❌ minimax / probabilidade fina (resume-driven; heurística já convence)
- ❌ persistir histórico/stats de partidas vs bot

**Constraint honesta:** o driver usa `setTimeout` em memória → a sala de treino fica colada a 1 processo. Pra treino (1 humano, websocket já fixa o processo) é irrelevante. Só seria problema no "preencher sala", que está fora de escopo.

## Componentes

### 1. Tipos — `types/shared.ts` (+ espelho no front)

- `Player` ganha `isBot?: boolean` e `botLevel?: BotLevel` (`'easy' | 'medium' | 'hard'`).
- `isBot`/`botLevel` **não são segredo** → fluem de graça pro `RedactedPlayer` (que é `Omit<Player,'hand'> & {hand}`), o front lê direto.

### 2. Cérebro — `game/bot/` (puro, sem socket, 100% testável)

Toda decisão é função pura `(view, …) → action`. A `BotView` é montada por `buildBotView(state, botId, memory, level)`: pra cada carta de cada mão ela expõe `{ cardId, index, rank }` onde `rank` vem de `knownRank` (a própria mão revela só o `revealedToSelf`/o que o bot espiou; mãos alheias só o que o bot viu via J/Q). Tudo que o bot não conhece legalmente vem como `rank: null` — então as decisões **não têm como trapacear**.

- **`bot/belief.ts`** — `BotMemory` (`known: { cardId, rank, turn }[]` + `lastSnapDiscardId`) chaveado por `cardId`, e as transições: `seedFromInitialPeek`, `learnCard`, `pruneAbsent`, `knownRank(mem, cardId, currentTurn, level): Rank | null` (aplica o `decay` do nível) e `buildBotView`. O Fácil esquece via `decay`; conhecimento sobrevive a swaps/cortes porque é por `cardId`.
- **`bot/decide-turn.ts`** — comprou carta `C`: acha minha carta conhecida de **maior valor** `H`. Se `value(C) < value(H)` → `swap` no slot de `H`. Senão, se `C` tem efeito útil (10/J/Q) e há slot desconhecido a explorar → `discard` usando efeito. Senão `discard` simples. Nunca troca/descarta K/JOKER conhecido.
- **`bot/decide-effect.ts`** — 10: espia slot próprio desconhecido. J: espia slot de oponente desconhecido. Q: troca minha **maior** conhecida pela menor conhecida do oponente (ou aposta num desconhecido, conforme nível).
- **`bot/decide-snap.ts`** — tenho slot que **sei** ser igual ao topo do descarte? → snap. Nível modula acerto e se arrisca em desconhecido.
- **`bot/decide-bate.ts`** — estima a mão (conhecidas exato + desconhecidas no valor esperado); bate se `estimativa ≤ limiar(level)` e for estrategicamente bom.
- **`bot/index.ts`** — `runBotTurn(state, botId, mem, level)` compõe um turno inteiro do bot via funções de engine puras (bate → draw → swap/discard → resolve/skip do efeito que sobra), devolvendo `{ state, memory }`; e `planBotAction(state, memories, hasConnectedHuman)` escolhe a única próxima ação pro driver (confirmar peek → snap → turno), ou `null`.

### 3. Driver — `game/bot/driver.ts` (única parte com efeito)

`scheduleBotActions(io, roomId)` — chamado **após cada broadcast** de sala que contém bots (guard barato: `state.players.some(p => p.isBot)`). Sob `withRoomLock`, decide o que agendar via `setTimeout` (= "pensar", duração do nível):

1. `initial-peek` → auto-confirma o peek dos bots (`lobby.addPeekConfirmation`, igual ao handler).
2. `playing`/`bate-called` e jogador da vez é bot → executa o turno **atômico** (draw → decide → keep/discard → eventual efeito) sob um lock só; o bot **não usa** o cache `drawnCard` (já tem a carta do retorno de `drawFromDeck`).
3. `effect-pending` com `pendingEffect.playerId` = bot → resolve/skip efeito.
4. Houve descarte novo → cada bot avalia **snap** (reação do nível); snap é contínuo no Batinho (sem janela discreta mid-round).

**Guard de vida:** o driver só age se a sala tem **≥1 humano conectado**. Sem humano, não dirige (deixa o idle sweep expirar a sala).

**À prova de travar:** cada ação do bot é protegida (`try/catch` + `.catch(log.error)`); se decidir errado/lançar, cai num move legal seguro (draw+discard). E o **backstop já existe**: se um turno de bot não rodar, o `turnDeadlineAt` vence e o loop de turn-timer (`index.ts:479`) chama `autoPlayExpiredTurn`. Sala nunca emperra.

### 4. Store de memória — interface `Storage` (`storage/types.ts` + Memory + Redis)

Novos métodos, espelhando `setDrawnCard/getDrawnCard/clearDrawnCard`:
```
setBotMemory(roomId, botId, mem): Promise<void>
getBotMemory(roomId, botId): Promise<BotMemory | undefined>
clearBotMemory(roomId): Promise<void>   // limpa todos os bots da sala
```
Implementado em `MemoryStorage` e `RedisStorage`. **Atenção:** `finishRound`/`startRound` são funções **puras** (sem I/O) — a limpeza de memória é chamada no **handler** `game-handlers.ts` (na transição de rodada, ao lado do `clearPeekConfirmations`) e no `leaveRoom` quando sobram só bots. Não vai no `lobby.ts` (pass-through burro) nem dentro das funções puras.

### 5. Handler de criação — `handlers/lobby-handlers.ts` + `handlers/schemas.ts`

Novo evento `room:create-practice` + `RoomCreatePracticeSchema` (`bots: 1|2|3`, `level: 'easy'|'medium'|'hard'`). O handler:
1. cria a sala com o humano como host (reusa o caminho de `lobby.createRoom`, `maxPlayers = bots + 1`, `private: true`);
2. injeta `N` `Player`s bot: `id = bot:<roomId>:<n>`, `socketId: null`, `isBot: true`, `botLevel`, nomes de persona ("Batinho", "Nozes", "Castanha");
3. `startRound` (auto) → `initial-peek`; semeia `BotMemory` de cada bot a partir do `revealedToSelf`;
4. persiste, `broadcastRoom`, e dispara `scheduleBotActions`.

### 6. Integração de broadcast — `handlers/broadcast.ts` / `final-snap.ts`

Ao final de `broadcastRoom` e `broadcastAfterAction`, se a sala tem bot → chamar `scheduleBotActions(io, state.roomId)`. Centraliza o gatilho: cobre tanto a ação do humano (que pode passar a vez pro bot) quanto a cadeia bot→bot. Guard por has-bot mantém custo zero pro multiplayer normal.

### 7. Frontend — `bate-frontend`

- Botão **"Treinar com bots"** no lobby (`Hero`/`RoomList`) → dialog: nº de bots (1–3) + nível.
- Emite `room:create-practice`; entra na sala normalmente.
- Bots renderizam como players com **badge/avatar de bot** (lê `isBot`/`botLevel` do `RedactedPlayer`). Reusa `Room`, `WaitingRoom`, `RoundEndScreen`, `MatchEndScreen` inteiros.
- `WaitingRoom`: como a sala já inicia cheia + auto-start, esconder o "esperando jogadores".

## Fluxo (sala de treino)

```
Humano clica "Treinar" → escolhe N bots + nível
  → room:create-practice → cria sala + injeta N bots (socketId:null, isBot) + startRound
  → initial-peek → driver auto-confirma peek dos bots → playing
  → a cada broadcast (humano OU bot agiu): scheduleBotActions
       → se vez do bot: setTimeout(pensar) → draw → decide → keep/discard → [efeito] → broadcast
       → se houve descarte: cada bot avalia snap (reação do nível)
  → fim: round-end / match-end normais → telas que já existem
```

## Edge cases

- **Humano sai no meio:** o `leaveRoom` remove a sala (`removeRoom` + `clearBotMemory`) **explicitamente** quando os jogadores restantes são todos bots. Isso é necessário porque salas de treino são `private:true` e o **idle sweep só varre salas não-privadas** — não dá pra confiar nele aqui. Enquanto há humano e ele só desconecta (sem sair), o driver para de agir pelo guard de "≥1 humano conectado" e a reconexão volta a dirigir.
- **Pause:** driver não age com `paused: true` (respeita `room:pause` do host).
- **Bate-called / final-snap:** bots participam normalmente; corte na janela final é reativo (já coberto pelo `decide-snap`).
- **Bot esvazia a mão no snap:** dispara `bate` automático no engine — sem caminho especial.
- **Reconexão do humano:** o `auto-rebind` já existente reanexa; o driver volta a agir (humano conectado de novo).
- **Sala removida durante um `setTimeout` agendado:** o callback re-busca a sala sob lock; se sumiu ou fase mudou ou `roundNumber` avançou → ignora (mesmo guard do turn-timer e do final-snap).
- **Deck vazio:** `endRoundEmptyDeck`/`autoPlayExpiredTurn` já tratam; bot não precisa de caminho próprio.

## Testes (Vitest, descrições em PT)

- **Unit puro do cérebro:**
  - `belief.ts`: semeia peek inicial; aprende carta própria (10) / de oponente (J); `applySwap` move conhecimento; `invalidateSlot` esquece slot trocado; `decay` no Fácil esquece após N turnos.
  - `decide-turn.ts`: troca carta alta conhecida por carta baixa comprada; **nunca** troca K/JOKER; descarta carta de efeito quando há slot a explorar.
  - `decide-snap.ts`: dá snap quando conhece rank igual ao topo; Fácil ignora parte das chances.
  - `decide-bate.ts`: bate quando estimativa ≤ limiar; estimativa usa valor esperado pra desconhecidas; Difícil bate mais cedo que Fácil.
- **Integração bot-vs-bot:** monta sala só de bots, roda **uma rodada inteira sem throw** e ela termina (`round-end`/`match-end`). Pega regressão e garante convergência do loop.
- **e2e (`pnpm test:e2e`):** com tempos de "pensar" curtos (env), cria sala de treino, humano simulado joga 1 turno, confirma que os bots agem em sequência e o estado avança até `round-end`.

## Arquivos tocados

- `src/types/shared.ts` (+ espelho no front): `isBot`/`botLevel` em `Player`; tipo `BotLevel`.
- `src/server/game/bot/`: `belief.ts`, `decide-turn.ts`, `decide-effect.ts`, `decide-snap.ts`, `decide-bate.ts`, `index.ts`, `driver.ts` (novos).
- `src/server/storage/types.ts` + `storage/memory.ts` + `storage/redis.ts`: métodos `*BotMemory`.
- `src/server/handlers/lobby-handlers.ts` + `handlers/schemas.ts`: `room:create-practice` + schema.
- `src/server/handlers/broadcast.ts` + `handlers/final-snap.ts`: gatilho `scheduleBotActions` (guard has-bot).
- `src/server/lobby.ts`: limpar `BotMemory` em `finishRound`/`startRound`/`removeRoom`.
- `bate-frontend`: tipos espelho, botão + dialog de treino, evento `room:create-practice`, badge de bot, `WaitingRoom` sem "esperando jogadores".
- Testes unit + integração + e2e listados acima.
