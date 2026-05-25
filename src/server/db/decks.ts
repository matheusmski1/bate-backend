import { AppDataSource } from './data-source'
import { Deck } from './entities/Deck'
import { User } from './entities/User'
import { UserDeck } from './entities/UserDeck'

export type DeckView = {
  id: string
  name: string
  unlockType: 'default' | 'earned' | 'paid'
  priceCoins: number
  previewPath: string
  owned: boolean
  equipped: boolean
}

export async function listDecksForUser(userId: string): Promise<DeckView[]> {
  const [all, owned, user] = await Promise.all([
    AppDataSource.getRepository(Deck).find({ order: { unlockType: 'ASC', priceCoins: 'ASC' } }),
    AppDataSource.getRepository(UserDeck).find({ where: { userId } }),
    AppDataSource.getRepository(User).findOne({ where: { id: userId } }),
  ])
  const ownedSet = new Set(owned.map(o => o.deckId))
  const equipped = user?.equippedDeck ?? 'default'
  return all.map(d => ({
    id: d.id,
    name: d.name,
    unlockType: d.unlockType,
    priceCoins: d.priceCoins,
    previewPath: d.previewPath,
    owned: ownedSet.has(d.id),
    equipped: equipped === d.id && ownedSet.has(d.id),
  }))
}

export async function equipDeckForUser(userId: string, deckId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const owned = await AppDataSource.getRepository(UserDeck).findOne({ where: { userId, deckId } })
  if (!owned) return { ok: false, error: 'DECK_NOT_OWNED' }
  await AppDataSource.getRepository(User).update({ id: userId }, { equippedDeck: deckId })
  return { ok: true }
}

export async function getEquippedDeck(userId: string): Promise<string> {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } })
  return user?.equippedDeck ?? 'default'
}
