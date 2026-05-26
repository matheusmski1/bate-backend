import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { User } from './entities/User'
import { Deck } from './entities/Deck'
import { UserDeck } from './entities/UserDeck'
import { Arena } from './entities/Arena'
import { UserArena } from './entities/UserArena'

const url = process.env.DATABASE_URL

if (!url) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production')
  }
  console.warn('[db] DATABASE_URL not set — datasource will fail on initialize()')
}

const useSSL = (() => {
  if (process.env.DATABASE_SSL === 'false') return false
  if (process.env.DATABASE_SSL === 'true') return true
  return process.env.NODE_ENV === 'production'
})()

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: url ?? '',
  synchronize: false,
  logging: process.env.DATABASE_LOG === 'true',
  entities: [User, Deck, UserDeck, Arena, UserArena],
  migrations: ['src/server/db/migrations/*.ts'],
  migrationsTableName: 'typeorm_migrations',
  ssl: useSSL ? { rejectUnauthorized: false } : false,
})
