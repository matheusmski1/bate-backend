type Bucket = { tokens: number; lastRefill: number }

const buckets = new Map<string, Bucket>()

const CAPACITY = 30
const REFILL_PER_SEC = 15

export function consume(socketId: string): boolean {
  const now = Date.now()
  let bucket = buckets.get(socketId)
  if (!bucket) {
    bucket = { tokens: CAPACITY, lastRefill: now }
    buckets.set(socketId, bucket)
  }
  const elapsedSec = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsedSec * REFILL_PER_SEC)
  bucket.lastRefill = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

export function release(socketId: string): void {
  buckets.delete(socketId)
}
