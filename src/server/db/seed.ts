import 'reflect-metadata'
import { AppDataSource } from './data-source'
import { seedDefaultSkins } from './seed-skins'

async function main() {
  await AppDataSource.initialize()
  const result = await seedDefaultSkins()
  console.log(`[seed] inserted=${result.inserted} updated=${result.updated}`)
  await AppDataSource.destroy()
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
