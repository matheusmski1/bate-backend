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

export function scheduleBotActions(io: SocketServer, state: GameState): void {
  const roomId = state.roomId
  if (!state.players.some(p => p.isBot)) return
  const existing = botTimers.get(roomId)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    botTimers.delete(roomId)
    void (async () => {
      await lobby.withRoomLock(roomId, async () => {
        const current = await lobby.getRoom(roomId)
        if (!current || !current.players.some(p => p.isBot)) return
        const hasHuman = current.players.some(
          p => !p.isBot && p.socketId !== null && io.sockets.sockets.has(p.socketId),
        )
        const memories = new Map<string, BotMemory>()
        for (const bot of current.players.filter(p => p.isBot)) {
          memories.set(bot.id, (await lobby.getBotMemory(roomId, bot.id)) ?? seedFromInitialPeek(current, bot.id, levelOf(bot.botLevel)))
        }

        const action = planBotAction(current, memories, hasHuman)
        if (!action) return

        if (action.kind === 'confirm-peeks') {
          let count = 0
          for (const bot of current.players.filter(p => p.isBot)) {
            count = await lobby.addPeekConfirmation(roomId, bot.id)
          }
          if (count >= current.players.length) {
            await lobby.clearPeekConfirmations(roomId)
            const next = startTurnTimer({ ...current, phase: 'playing' as const })
            await lobby.setRoom(next)
            broadcastRoom(io, next)
          }
          return
        }

        if (action.kind === 'snap') {
          const top = current.discard[current.discard.length - 1]
          const next = snapCard(current, action.botId, action.handIndex)
          await lobby.setRoom(next)
          const mem = memories.get(action.botId)!
          await lobby.setBotMemory(roomId, action.botId, { ...mem, lastSnapDiscardId: top?.id ?? null })
          broadcastRoom(io, next)
          return
        }

        const bot = current.players.find(p => p.id === action.botId)!
        const mem = memories.get(action.botId)!
        const out = runBotTurn(current, action.botId, mem, levelOf(bot.botLevel))
        await lobby.setRoom(out.state)
        await lobby.setBotMemory(roomId, action.botId, pruneAbsent(out.memory, out.state))
        broadcastRoom(io, out.state)
      })
    })().catch(err => log.error('bot-driver', 'tick failed', { roomId, error: err instanceof Error ? err.message : 'UNKNOWN' }))
  }, pickThinkMs(state))

  botTimers.set(roomId, timer)
}
