import { AppDataSource } from './data-source'
import { User } from './entities/User'
import { Skin } from './entities/Skin'
import { Deck } from './entities/Deck'
import { Arena } from './entities/Arena'
import { UserSkin } from './entities/UserSkin'
import { UserDeck } from './entities/UserDeck'
import { UserArena } from './entities/UserArena'

export async function ensureUser(playerId: string, displayName = ''): Promise<User> {
  const repo = AppDataSource.getRepository(User)
  const existing = await repo.findOne({ where: { id: playerId } })
  if (existing) {
    existing.lastSeenAt = new Date()
    if (displayName && displayName !== existing.displayName) existing.displayName = displayName
    await repo.save(existing)
    return existing
  }
  const user = repo.create({ id: playerId, displayName, equippedSkin: 'default', equippedDeck: 'default', equippedArena: 'default' })
  await repo.save(user)
  const [defaultSkins, defaultDecks, defaultArenas] = await Promise.all([
    AppDataSource.getRepository(Skin).find({ where: { unlockType: 'default' } }),
    AppDataSource.getRepository(Deck).find({ where: { unlockType: 'default' } }),
    AppDataSource.getRepository(Arena).find({ where: { unlockType: 'default' } }),
  ])
  for (const skin of defaultSkins) await grantSkin(playerId, skin.id, 'default')
  for (const deck of defaultDecks) await grantDeck(playerId, deck.id, 'default')
  for (const arena of defaultArenas) await grantArena(playerId, arena.id, 'default')
  return user
}

export async function grantDeck(userId: string, deckId: string, via: 'default' | 'earned' | 'purchased' = 'default'): Promise<void> {
  const repo = AppDataSource.getRepository(UserDeck)
  const existing = await repo.findOne({ where: { userId, deckId } })
  if (existing) return
  await repo.insert({ userId, deckId, acquiredVia: via })
}

export async function grantSkin(userId: string, skinId: string, via: 'default' | 'earned' | 'purchased' = 'default'): Promise<void> {
  const repo = AppDataSource.getRepository(UserSkin)
  const existing = await repo.findOne({ where: { userId, skinId } })
  if (existing) return
  await repo.insert({ userId, skinId, acquiredVia: via })
}

export async function grantArena(userId: string, arenaId: string, via: 'default' | 'earned' | 'purchased' = 'default'): Promise<void> {
  const repo = AppDataSource.getRepository(UserArena)
  const existing = await repo.findOne({ where: { userId, arenaId } })
  if (existing) return
  await repo.insert({ userId, arenaId, acquiredVia: via })
}

export async function getUserSkins(userId: string): Promise<UserSkin[]> {
  return AppDataSource.getRepository(UserSkin).find({ where: { userId } })
}

export async function equipSkin(userId: string, skinId: string): Promise<boolean> {
  const owned = await AppDataSource.getRepository(UserSkin).findOne({ where: { userId, skinId } })
  if (!owned) return false
  await AppDataSource.getRepository(User).update({ id: userId }, { equippedSkin: skinId })
  return true
}
