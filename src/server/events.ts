import { EventEmitter } from 'node:events'

export type GameActionEvent = {
  event: string
  roomId: string
  playerId: string
  ms: number
  ok: boolean
}

export type BroadcastEvent = {
  roomId: string
  phase: string
  recipients: number
  roundNumber: number
  roundStartedAt: number | null
}

class GameEventBus extends EventEmitter {
  emitAction(payload: GameActionEvent): void {
    this.emit('action', payload)
  }

  emitBroadcast(payload: BroadcastEvent): void {
    this.emit('broadcast', payload)
  }

  onAction(handler: (payload: GameActionEvent) => void): void {
    this.on('action', handler)
  }

  onBroadcast(handler: (payload: BroadcastEvent) => void): void {
    this.on('broadcast', handler)
  }
}

export const gameEvents = new GameEventBus()
gameEvents.setMaxListeners(50)
