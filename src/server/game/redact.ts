import type { GameState, RedactedCard, RedactedPlayer, RedactedState } from '@/types/shared'

export function redactStateForPlayer(state: GameState, viewerId: string): RedactedState {
  const players: RedactedPlayer[] = state.players.map(p => {
    const isViewer = p.id === viewerId
    const hand: RedactedCard[] = p.hand.map(c => {
      if (isViewer && p.revealedToSelf.includes(c.id)) {
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
  }
}
