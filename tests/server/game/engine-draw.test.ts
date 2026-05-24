import { describe, it, expect } from 'vitest'
import { drawFromDeck, discardDrawnCard, swapAndDiscard } from '@/server/game/engine'
import { createEmptyRoom, startRound } from '@/server/game/state'
import type { GameState, Player } from '@/types/shared'

function twoPlayerRound(): GameState {
  const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
  empty.players.push({
    id: 'p2', socketId: null, name: 'b', hand: [], score: 0,
    connected: true, disconnectedAt: null, revealedToSelf: [],
  })
  const round = startRound(empty)
  return { ...round, phase: 'playing' }
}

describe('drawFromDeck', () => {
  it('retira a carta do topo do deck e retorna junto com novo estado', () => {
    const state = twoPlayerRound()
    const deckSizeBefore = state.deck.length
    const topCard = state.deck[deckSizeBefore - 1]!
    const { state: next, card } = drawFromDeck(state, 'p1')
    expect(card.id).toBe(topCard.id)
    expect(next.deck.length).toBe(deckSizeBefore - 1)
  })

  it('lança se não for o turno do player', () => {
    const state = twoPlayerRound()
    expect(() => drawFromDeck(state, 'p2')).toThrow('NOT_YOUR_TURN')
  })

  it('lança se a fase não for playing', () => {
    const state = { ...twoPlayerRound(), phase: 'waiting' as const }
    expect(() => drawFromDeck(state, 'p1')).toThrow('INVALID_PHASE')
  })
})

describe('discardDrawnCard', () => {
  it('coloca carta no topo do descarte; avança turno se carta normal', () => {
    const state = twoPlayerRound()
    const { state: afterDraw, card } = drawFromDeck(state, 'p1')
    const next = discardDrawnCard(afterDraw, 'p1', card)
    expect(next.discard[next.discard.length - 1]?.id).toBe(card.id)
    if (['10', 'J', 'Q'].includes(card.rank)) {
      expect(next.phase).toBe('effect-pending')
    } else {
      expect(next.turn).toBe(1)
    }
  })

  it('mantém snapWindow null (snap sem janela de tempo)', () => {
    const state = twoPlayerRound()
    const { state: afterDraw, card } = drawFromDeck(state, 'p1')
    const next = discardDrawnCard(afterDraw, 'p1', card)
    expect(next.snapWindow).toBeNull()
  })
})

describe('swapAndDiscard', () => {
  it('substitui carta da mão pela carta comprada; antiga vai pro descarte', () => {
    const state = twoPlayerRound()
    const oldCardInHand = state.players[0]!.hand[0]!
    const { state: afterDraw, card: drawn } = drawFromDeck(state, 'p1')
    const next = swapAndDiscard(afterDraw, 'p1', drawn, 0)
    expect(next.players[0]?.hand[0]?.id).toBe(drawn.id)
    expect(next.discard[next.discard.length - 1]?.id).toBe(oldCardInHand.id)
    const wasSpecial = ['10', 'J', 'Q'].includes(oldCardInHand.rank)
    if (wasSpecial) {
      expect(next.phase).toBe('effect-pending')
      expect(next.turn).toBe(0)
    } else {
      expect(next.turn).toBe(1)
    }
  })

  it('se carta substituída é especial (Q), fase vira effect-pending', () => {
    const empty = createEmptyRoom({ roomId: 'r1', name: 'm', hostId: 'p1', hostName: 'a', maxPlayers: 2 })
    empty.players.push({
      id: 'p2', socketId: null, name: 'b', hand: [], score: 0,
      connected: true, disconnectedAt: null, revealedToSelf: [],
    })
    const state: GameState = {
      ...empty,
      phase: 'playing',
      players: [
        { ...empty.players[0]!, hand: [{ id: 'q1', rank: 'Q', suit: 'hearts' }, { id: '5h', rank: '5', suit: 'hearts' }] },
        { ...empty.players[1]!, hand: [{ id: 'a1', rank: 'A', suit: 'clubs' }, { id: '7s', rank: '7', suit: 'spades' }] },
      ],
      deck: [{ id: 'drawn', rank: '3', suit: 'diamonds' }],
    }
    const { state: afterDraw, card } = drawFromDeck(state, 'p1')
    const next = swapAndDiscard(afterDraw, 'p1', card, 0)
    expect(next.phase).toBe('effect-pending')
    expect(next.pendingEffect?.type).toBe('swap')
    expect(next.pendingEffect?.playerId).toBe('p1')
    expect(next.discard[next.discard.length - 1]?.id).toBe('q1')
    expect(next.players[0]?.hand[0]?.id).toBe('drawn')
  })
})
