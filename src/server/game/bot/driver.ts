import type { Server as SocketServer } from 'socket.io'
import type { GameState, BotLevel } from '@/types/shared'
import { lobby } from '@/server/lobby'
import { snapCard, startTurnTimer } from '../engine'
import { broadcastRoom } from '@/server/handlers/broadcast'
import { log } from '@/server/logger'
import { planBotAction, runBotTurn } from './index'
import { seedFromInitialPeek, pruneAbsent, type BotMemory } from './belief'
import { LEVEL_CONFIG } from './config'

const botTimers = new Map<string, ReturnType<typeof setTimeout>>()

function levelOf(level: BotLevel | undefined): BotLevel {
  return level ?? 'medium'
}

function pickThinkMs(state: GameState): number {
  const bot = state.players.find(p => p.isBot && p.id === state.players[state.turn]?.id) ?? state.players.find(p => p.isBot)
  const [lo, hi] = LEVEL_CONFIG[levelOf(bot?.botLevel)].thinkMs
  return lo + Math.floor(Math.random() * (hi - lo))
}

export function scheduleBotActions(io: SocketServer, roomId: string): void {
  const existing = botTimers.get(roomId)
  if (existing) clearTimeout(existing)

  const peek = botTimers.has(roomId)
  void (async () => {
    const snapshot = await lobby.getRoom(roomId)
    if (!snapshot || !snapshot.players.some(p => p.isBot)) return
    const delay = pickThinkMs(snapshot)

    const timer = setTimeout(() => {
      botTimers.delete(roomId)
      void (async () => {
        await lobby.withRoomLock(roomId, async () => {
          const state = await lobby.getRoom(roomId)
          if (!state || !state.players.some(p => p.isBot)) return
          const hasHuman = state.players.some(
            p => !p.isBot && p.socketId !== null && io.sockets.sockets.has(p.socketId),
          )
          const memories = new Map<string, BotMemory>()
          for (const bot of state.players.filter(p => p.isBot)) {
            memories.set(bot.id, (await lobby.getBotMemory(roomId, bot.id)) ?? seedFromInitialPeek(state, bot.id, levelOf(bot.botLevel)))
          }

          const action = planBotAction(state, memories, hasHuman)
          if (!action) return

          if (action.kind === 'confirm-peeks') {
            let count = 0
            for (const bot of state.players.filter(p => p.isBot)) {
              count = await lobby.addPeekConfirmation(roomId, bot.id)
            }
            if (count >= state.players.length) {
              await lobby.clearPeekConfirmations(roomId)
              const next = startTurnTimer({ ...state, phase: 'playing' as const })
              await lobby.setRoom(next)
              broadcastRoom(io, next)
            }
            return
          }

          if (action.kind === 'snap') {
            const top = state.discard[state.discard.length - 1]
            const next = snapCard(state, action.botId, action.handIndex)
            await lobby.setRoom(next)
            const mem = memories.get(action.botId)!
            await lobby.setBotMemory(roomId, action.botId, { ...mem, lastSnapDiscardId: top?.id ?? null })
            broadcastRoom(io, next)
            return
          }

          const bot = state.players.find(p => p.id === action.botId)!
          const mem = memories.get(action.botId)!
          const out = runBotTurn(state, action.botId, mem, levelOf(bot.botLevel))
          await lobby.setRoom(out.state)
          await lobby.setBotMemory(roomId, action.botId, pruneAbsent(out.memory, out.state))
          broadcastRoom(io, out.state)
        })
      })().catch(err => log.error('bot-driver', 'tick failed', { roomId, error: err instanceof Error ? err.message : 'UNKNOWN' }))
    }, delay)

    botTimers.set(roomId, timer)
  })().catch(err => log.error('bot-driver', 'schedule failed', { roomId, peek, error: err instanceof Error ? err.message : 'UNKNOWN' }))
}
