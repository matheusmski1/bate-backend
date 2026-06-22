import { describe, it, expect } from 'vitest'
import { runBotTurn } from '@/server/game/bot/index'
import { seedFromInitialPeek, pruneAbsent, type BotMemory } from '@/server/game/bot/belief'
import { practiceRound } from './fixtures'
import type { GameState } from '@/types/shared'

describe('bot-vs-bot', () => {
  it('uma rodada so de bots termina sem lancar e converge', () => {
    let state: GameState = { ...practiceRound(['hard', 'hard']), turn: 0 }
    const mems = new Map<string, BotMemory>()
    for (const p of state.players) mems.set(p.id, seedFromInitialPeek(state, p.id, 'hard'))

    const CAP = 400
    let i = 0
    while (state.phase === 'playing' || state.phase === 'bate-called') {
      if (i++ > CAP) throw new Error('bot loop nao convergiu')
      const botId = state.players[state.turn]!.id
      const out = runBotTurn(state, botId, mems.get(botId)!, 'hard')
      state = out.state
      mems.set(botId, pruneAbsent(out.memory, state))
    }
    expect(['round-end', 'match-end', 'final-snap']).toContain(state.phase)
  })
})
