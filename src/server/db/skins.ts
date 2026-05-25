import { AppDataSource } from './data-source'
import { Skin } from './entities/Skin'
import { User } from './entities/User'
import { UserSkin } from './entities/UserSkin'

export type SkinView = {
  id: string
  name: string
  unlockType: 'default' | 'earned' | 'paid'
  priceCoins: number
  imagePath: string
  owned: boolean
  equipped: boolean
}

export async function listSkinsForUser(userId: string): Promise<SkinView[]> {
  const [all, owned, user] = await Promise.all([
    AppDataSource.getRepository(Skin).find({ order: { unlockType: 'ASC', priceCoins: 'ASC' } }),
    AppDataSource.getRepository(UserSkin).find({ where: { userId } }),
    AppDataSource.getRepository(User).findOne({ where: { id: userId } }),
  ])
  const ownedSet = new Set(owned.map(o => o.skinId))
  const equipped = user?.equippedSkin ?? 'default'
  return all.map(s => ({
    id: s.id,
    name: s.name,
    unlockType: s.unlockType,
    priceCoins: s.priceCoins,
    imagePath: s.imagePath,
    owned: ownedSet.has(s.id),
    equipped: equipped === s.id && ownedSet.has(s.id),
  }))
}

export async function equipSkinForUser(userId: string, skinId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const owned = await AppDataSource.getRepository(UserSkin).findOne({ where: { userId, skinId } })
  if (!owned) return { ok: false, error: 'SKIN_NOT_OWNED' }
  await AppDataSource.getRepository(User).update({ id: userId }, { equippedSkin: skinId })
  return { ok: true }
}

export async function getEquippedSkin(userId: string): Promise<string> {
  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } })
  return user?.equippedSkin ?? 'default'
}
