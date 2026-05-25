import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { Skin } from './entities/Skin'

const DEFAULT_SKINS: Array<Pick<Skin, 'id' | 'name' | 'unlockType' | 'priceCoins' | 'imagePath'>> = [
  { id: 'default', name: 'Batinho Clássico', unlockType: 'default', priceCoins: 0, imagePath: '/batinho/batinho-feliz.webp' },
  { id: 'ouro', name: 'Batinho Ouro', unlockType: 'earned', priceCoins: 0, imagePath: '/batinho/batinho-ouro.webp' },
  { id: 'prata', name: 'Batinho Prata', unlockType: 'earned', priceCoins: 0, imagePath: '/batinho/batinho-prata.webp' },
  { id: 'trofeu', name: 'Batinho Troféu', unlockType: 'earned', priceCoins: 0, imagePath: '/batinho/batinho-trofeu.webp' },
  { id: 'lupa', name: 'Batinho Detetive', unlockType: 'paid', priceCoins: 200, imagePath: '/batinho/batinho-lupa.webp' },
  { id: 'bate', name: 'Batinho Anunciador', unlockType: 'paid', priceCoins: 200, imagePath: '/batinho/batinho-bate.webp' },
]

async function main() {
  await AppDataSource.initialize()
  const repo = AppDataSource.getRepository(Skin)
  for (const skin of DEFAULT_SKINS) {
    const existing = await repo.findOne({ where: { id: skin.id } })
    if (existing) {
      await repo.update({ id: skin.id }, skin)
      console.log(`[seed] updated ${skin.id}`)
    } else {
      await repo.insert(skin)
      console.log(`[seed] inserted ${skin.id}`)
    }
  }
  await AppDataSource.destroy()
  console.log('[seed] done')
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
