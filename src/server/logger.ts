import type { GameState } from '@/types/shared'

type Level = 'info' | 'warn' | 'error'

function emit(level: Level, scope: string, msg: string, data?: Record<string, unknown>) {
  const time = new Date().toISOString()
  const dataStr = data && Object.keys(data).length ? ' ' + JSON.stringify(data) : ''
  const line = `[${time}] [${level.toUpperCase()}] [${scope}] ${msg}${dataStr}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (scope: string, msg: string, data?: Record<string, unknown>) => emit('info', scope, msg, data),
  warn: (scope: string, msg: string, data?: Record<string, unknown>) => emit('warn', scope, msg, data),
  error: (scope: string, msg: string, data?: Record<string, unknown>) => emit('error', scope, msg, data),
}

export function snapshot(state: GameState | undefined | null) {
  if (!state) return { exists: false }
  return {
    phase: state.phase,
    turn: state.turn,
    currentPlayer: state.players[state.turn]?.id ?? null,
    deck: state.deck.length,
    discard: state.discard.length,
    logLen: state.log.length,
    caboCaller: state.caboCallerId,
    pendingEffect: state.pendingEffect ? `${state.pendingEffect.type}:${state.pendingEffect.playerId}` : null,
    snapWindow: !!state.snapWindow,
    players: state.players.map(p => ({ id: p.id, name: p.name, hand: p.hand.length, score: p.score, socket: p.socketId ?? null })),
  }
}
