import { AppDataSource } from './data-source'
import { Deck } from './entities/Deck'
import { User } from './entities/User'
import { UserDeck } from './entities/UserDeck'

const DEFAULT_DECKS: Array<Pick<Deck, 'id' | 'name' | 'unlockType' | 'priceCoins' | 'previewPath'>> = [
  { id: 'default', name: 'Batinho Clássico', unlockType: 'default', priceCoins: 0, previewPath: '/cards/batinho-as.webp' },
  { id: 'corinthians', name: 'Timão', unlockType: 'default', priceCoins: 0, previewPath: '/cards/corinthians/as.webp' },
]

export async function seedDefaultDecks(): Promise<{ inserted: number; updated: number }> {
  const repo = AppDataSource.getRepository(Deck)
  let inserted = 0
  let updated = 0
  for (const deck of DEFAULT_DECKS) {
    const existing = await repo.findOne({ where: { id: deck.id } })
    if (existing) {
      await repo.update({ id: deck.id }, deck)
      updated += 1
    } else {
      await repo.insert(deck)
      inserted += 1
    }
  }
  return { inserted, updated }
}

export async function backfillDefaultDecksToAllUsers(): Promise<{ granted: number }> {
  const defaultDeckIds = (await AppDataSource.getRepository(Deck).find({ where: { unlockType: 'default' } })).map(d => d.id)
  if (defaultDeckIds.length === 0) return { granted: 0 }
  const users = await AppDataSource.getRepository(User).find({ select: ['id'] })
  const userDeckRepo = AppDataSource.getRepository(UserDeck)
  let granted = 0
  for (const user of users) {
    for (const deckId of defaultDeckIds) {
      const existing = await userDeckRepo.findOne({ where: { userId: user.id, deckId } })
      if (existing) continue
      await userDeckRepo.insert({ userId: user.id, deckId, acquiredVia: 'default' })
      granted += 1
    }
  }
  return { granted }
}
