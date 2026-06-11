import type { GameState, RedactedCard, RedactedPlayer, RedactedState } from '@/types/shared'
import { trimLog } from './state'

const BROADCAST_LOG_LIMIT = 40

export function redactStateForPlayer(state: GameState, viewerId: string, asSpectator = false): RedactedState {
  const revealAll = asSpectator || state.phase === 'round-end' || state.phase === 'match-end'
  const players: RedactedPlayer[] = state.players.map(p => {
    const isViewer = p.id === viewerId
    const hand: RedactedCard[] = p.hand.map(c => {
      if (revealAll || (isViewer && p.revealedToSelf.includes(c.id))) {
        return { id: c.id, rank: c.rank, suit: c.suit }
      }
      return { id: c.id, hidden: true }
    })
    const { hand: _omit, ...rest } = p
    return { ...rest, hand }
  })
  const { deck: _deck, players: _players, ...rest } = state
  return {
    ...rest,
    players,
    deckCount: state.deck.length,
    log: trimLog(state.log, BROADCAST_LOG_LIMIT),
  }
}
