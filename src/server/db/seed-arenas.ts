import { AppDataSource } from './data-source'
import { Arena } from './entities/Arena'
import { User } from './entities/User'
import { UserArena } from './entities/UserArena'

const DEFAULT_ARENAS: Array<Pick<Arena, 'id' | 'name' | 'unlockType' | 'priceCoins' | 'previewPath'>> = [
  { id: 'default', name: 'Padrão', unlockType: 'default', priceCoins: 0, previewPath: '/arenas/default/thumb.webp' },
  { id: 'boteco', name: 'Boteco do Batinho', unlockType: 'default', priceCoins: 0, previewPath: '/arenas/boteco/thumb.webp' },
]

export async function seedDefaultArenas(): Promise<{ inserted: number; updated: number }> {
  const repo = AppDataSource.getRepository(Arena)
  let inserted = 0
  let updated = 0
  for (const arena of DEFAULT_ARENAS) {
    const existing = await repo.findOne({ where: { id: arena.id } })
    if (existing) {
      await repo.update({ id: arena.id }, arena)
      updated += 1
    } else {
      await repo.insert(arena)
      inserted += 1
    }
  }
  return { inserted, updated }
}

export async function backfillDefaultArenasToAllUsers(): Promise<{ granted: number }> {
  const defaultArenaIds = (await AppDataSource.getRepository(Arena).find({ where: { unlockType: 'default' } })).map(a => a.id)
  if (defaultArenaIds.length === 0) return { granted: 0 }
  const users = await AppDataSource.getRepository(User).find({ select: ['id'] })
  const userArenaRepo = AppDataSource.getRepository(UserArena)
  let granted = 0
  for (const user of users) {
    for (const arenaId of defaultArenaIds) {
      const existing = await userArenaRepo.findOne({ where: { userId: user.id, arenaId } })
      if (existing) continue
      await userArenaRepo.insert({ userId: user.id, arenaId, acquiredVia: 'default' })
      granted += 1
    }
  }
  return { granted }
}
