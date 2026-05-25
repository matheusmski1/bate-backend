import { AppDataSource } from './data-source'
import { Arena } from './entities/Arena'
import { User } from './entities/User'
import { UserArena } from './entities/UserArena'

export type ArenaView = {
  id: string
  name: string
  unlockType: 'default' | 'earned' | 'paid'
  priceCoins: number
  previewPath: string
  owned: boolean
  equipped: boolean
}

export async function listArenasForUser(userId: string): Promise<ArenaView[]> {
  const [all, owned, user] = await Promise.all([
    AppDataSource.getRepository(Arena).find({ order: { unlockType: 'ASC', priceCoins: 'ASC' } }),
    AppDataSource.getRepository(UserArena).find({ where: { userId } }),
    AppDataSource.getRepository(User).findOne({ where: { id: userId } }),
  ])
  const ownedSet = new Set(owned.map(o => o.arenaId))
  const equipped = user?.equippedArena ?? 'default'
  return all.map(a => ({
    id: a.id,
    name: a.name,
    unlockType: a.unlockType,
    priceCoins: a.priceCoins,
    previewPath: a.previewPath,
    owned: ownedSet.has(a.id),
    equipped: equipped === a.id && ownedSet.has(a.id),
  }))
}

export async function equipArenaForUser(userId: string, arenaId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const owned = await AppDataSource.getRepository(UserArena).findOne({ where: { userId, arenaId } })
  if (!owned) return { ok: false, error: 'ARENA_NOT_OWNED' }
  await AppDataSource.getRepository(User).update({ id: userId }, { equippedArena: arenaId })
  return { ok: true }
}

export async function getEquippedArena(userId: string): Promise<string> {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } })
  return user?.equippedArena ?? 'default'
}
