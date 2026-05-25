import { AppDataSource } from './data-source'
import { Deck } from './entities/Deck'

const DEFAULT_DECKS: Array<Pick<Deck, 'id' | 'name' | 'unlockType' | 'priceCoins' | 'previewPath'>> = [
  { id: 'default', name: 'Batinho Clássico', unlockType: 'default', priceCoins: 0, previewPath: '/cards/batinho-as.webp' },
  { id: 'corinthians', name: 'Timão', unlockType: 'paid', priceCoins: 800, previewPath: '/cards/corinthians/as.webp' },
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
