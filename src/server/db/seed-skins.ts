import { AppDataSource } from './data-source'
import { Skin } from './entities/Skin'
import { User } from './entities/User'
import { UserSkin } from './entities/UserSkin'

const DEFAULT_SKINS: Array<Pick<Skin, 'id' | 'name' | 'unlockType' | 'priceCoins' | 'imagePath'>> = [
  { id: 'default', name: 'Batinho Clássico', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-feliz.webp' },
  { id: 'ouro', name: 'Batinho Ouro', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-ouro.webp' },
  { id: 'prata', name: 'Batinho Prata', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-prata.webp' },
  { id: 'trofeu', name: 'Batinho Troféu', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-trofeu.webp' },
  { id: 'lupa', name: 'Batinho Detetive', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-lupa.webp' },
  { id: 'bate', name: 'Batinho Anunciador', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-bate.webp' },
]

export async function seedDefaultSkins(): Promise<{ inserted: number; updated: number }> {
  const repo = AppDataSource.getRepository(Skin)
  let inserted = 0
  let updated = 0
  for (const skin of DEFAULT_SKINS) {
    const existing = await repo.findOne({ where: { id: skin.id } })
    if (existing) {
      await repo.update({ id: skin.id }, skin)
      updated += 1
    } else {
      await repo.insert(skin)
      inserted += 1
    }
  }
  return { inserted, updated }
}

export async function backfillDefaultSkinsToAllUsers(): Promise<{ granted: number }> {
  const defaultSkinIds = (await AppDataSource.getRepository(Skin).find({ where: { unlockType: 'default' } })).map(s => s.id)
  if (defaultSkinIds.length === 0) return { granted: 0 }
  const users = await AppDataSource.getRepository(User).find({ select: ['id'] })
  const userSkinRepo = AppDataSource.getRepository(UserSkin)
  let granted = 0
  for (const user of users) {
    for (const skinId of defaultSkinIds) {
      const existing = await userSkinRepo.findOne({ where: { userId: user.id, skinId } })
      if (existing) continue
      await userSkinRepo.insert({ userId: user.id, skinId, acquiredVia: 'default' })
      granted += 1
    }
  }
  return { granted }
}
