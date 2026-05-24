import type { Storage } from './types'
import { MemoryStorage } from './memory'
import { RedisStorage } from './redis'

let instance: Storage | null = null

export function getStorage(): Storage {
  if (!instance) {
    const url = process.env.REDIS_URL
    if (url) {
      console.log('[storage] using RedisStorage')
      instance = new RedisStorage(url)
    } else {
      console.log('[storage] using MemoryStorage (no REDIS_URL)')
      instance = new MemoryStorage()
    }
  }
  return instance
}

export function setStorage(s: Storage): void {
  instance = s
}

export type { Storage, CreateRoomInput, JoinInput, SocketBinding, DrawnCacheEntry } from './types'
