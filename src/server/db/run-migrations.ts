import 'reflect-metadata'
import { AppDataSource } from './data-source'

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('[migrations] DATABASE_URL not set, skipping')
    process.exit(0)
  }
  await AppDataSource.initialize()
  const pending = await AppDataSource.showMigrations()
  if (!pending) {
    console.log('[migrations] no pending migrations')
  } else {
    console.log('[migrations] running pending migrations')
  }
  await AppDataSource.runMigrations({ transaction: 'each' })
  await AppDataSource.destroy()
  console.log('[migrations] done')
}

main().catch(err => {
  console.error('[migrations] failed:', err)
  process.exit(1)
})
