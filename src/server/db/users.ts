import { AppDataSource } from './data-source'
import { User } from './entities/User'
import { Deck } from './entities/Deck'
import { Arena } from './entities/Arena'
import { UserDeck } from './entities/UserDeck'
import { UserArena } from './entities/UserArena'

export async function ensureUser(playerId: string, displayName = ''): Promise<User> {
  const repo = AppDataSource.getRepository(User)
  const existing = await repo.findOne({ where: { id: playerId } })
  const user = existing ?? repo.create({ id: playerId, displayName, equippedDeck: 'default', equippedArena: 'default' })
  if (existing) {
    existing.lastSeenAt = new Date()
    if (displayName && displayName !== existing.displayName) existing.displayName = displayName
  }
  await repo.save(user)
  await grantAllDefaultsToUser(playerId)
  return user
}

async function grantAllDefaultsToUser(userId: string): Promise<void> {
  const [defaultDecks, defaultArenas] = await Promise.all([
    AppDataSource.getRepository(Deck).find({ where: { unlockType: 'default' } }),
    AppDataSource.getRepository(Arena).find({ where: { unlockType: 'default' } }),
  ])
  for (const deck of defaultDecks) await grantDeck(userId, deck.id, 'default')
  for (const arena of defaultArenas) await grantArena(userId, arena.id, 'default')
}

export async function grantDeck(userId: string, deckId: string, via: 'default' | 'earned' | 'purchased' = 'default'): Promise<void> {
  const repo = AppDataSource.getRepository(UserDeck)
  const existing = await repo.findOne({ where: { userId, deckId } })
  if (existing) return
  await repo.insert({ userId, deckId, acquiredVia: via })
}

export async function grantArena(userId: string, arenaId: string, via: 'default' | 'earned' | 'purchased' = 'default'): Promise<void> {
  const repo = AppDataSource.getRepository(UserArena)
  const existing = await repo.findOne({ where: { userId, arenaId } })
  if (existing) return
  await repo.insert({ userId, arenaId, acquiredVia: via })
}

