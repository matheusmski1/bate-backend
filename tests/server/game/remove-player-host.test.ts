import { describe, it, expect } from 'vitest'
import { removePlayerMidGame } from '@/server/game/engine'
import type { Card, GameState, Player } from '@/types/shared'

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts', id = `${rank}-${suit}`): Card {
  return { id, rank, suit }
}

function makeState(): GameState {
  const humanHost: Player = {
    id: 'host-human', socketId: null, name: 'Host', hand: [card('A'), card('2')], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
    isBot: false,
  }
  const bot: Player = {
    id: 'bot:R1:0', socketId: null, name: 'Bot', hand: [card('3'), card('4')], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
    isBot: true, botLevel: 'medium',
  }
  const humanB: Player = {
    id: 'human-b', socketId: null, name: 'Jogador B', hand: [card('5'), card('6')], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [], deck: 'default', arena: 'default',
    isBot: false,
  }
  return {
    roomId: 'R1', name: 'Treino', hostId: 'host-human', maxPlayers: 4,
    players: [humanHost, bot, humanB],
    pendingJoins: [], deck: [], discard: [card('7')],
    turn: 0, phase: 'playing',
    bateCallerId: null, turnsRemaining: null,
    pendingEffect: null, snapWindow: null,
    log: [], createdAt: Date.now(), turnTimeLimitSec: 60, turnDeadlineAt: null,
    paused: false, pausedRemainingMs: null, roundTurnCount: 1, roundNumber: 1,
    roundStartedAt: Date.now(), spectators: [],
  }
}

describe('removePlayerMidGame — reescolha de host', () => {
  it('quando o host humano sai, o próximo host deve ser o humano conectado (não o bot)', () => {
    const state = makeState()
    const next = removePlayerMidGame(state, 'host-human')
    expect(next.hostId).toBe('human-b')
    expect(next.hostId).not.toBe('bot:R1:0')
  })

  it('quando o host humano sai e o único humano restante está desconectado, escolhe o humano mesmo assim (não o bot)', () => {
    const state = makeState()
    const disconnectedB = state.players.map(p =>
      p.id === 'human-b' ? { ...p, connected: false } : p,
    )
    const stateWithDisconnected = { ...state, players: disconnectedB }
    const next = removePlayerMidGame(stateWithDisconnected, 'host-human')
    expect(next.hostId).toBe('human-b')
    expect(next.hostId).not.toBe('bot:R1:0')
  })
})
