import 'reflect-metadata'
import { AppDataSource } from './data-source'

async function main() {
  await AppDataSource.initialize()
  await AppDataSource.destroy()
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
