type Bucket = { tokens: number; lastRefill: number }
type Limit = { capacity: number; refillPerSec: number }

const buckets = new Map<string, Bucket>()

const DEFAULT_LIMIT: Limit = { capacity: 15, refillPerSec: 10 }

const PER_EVENT_LIMITS: Record<string, Limit> = {
  'game:snap': { capacity: 5, refillPerSec: 5 },
  'game:draw': { capacity: 2, refillPerSec: 1 },
  'game:keep-or-discard': { capacity: 2, refillPerSec: 1 },
  'game:effect-target': { capacity: 4, refillPerSec: 2 },
  'game:skip-effect': { capacity: 2, refillPerSec: 1 },
  'game:bate': { capacity: 1, refillPerSec: 0.2 },
  'game:initial-peek-done': { capacity: 2, refillPerSec: 1 },
  'game:start': { capacity: 1, refillPerSec: 0.5 },
  'game:next-round': { capacity: 1, refillPerSec: 0.5 },
  'room:emote': { capacity: 2, refillPerSec: 0.5 },
  'room:pause': { capacity: 2, refillPerSec: 1 },
  'room:join': { capacity: 3, refillPerSec: 0.5 },
  'room:spectate': { capacity: 3, refillPerSec: 0.5 },
  'room:create': { capacity: 2, refillPerSec: 0.2 },
  'room:leave': { capacity: 2, refillPerSec: 1 },
}

function key(socketId: string, event: string): string {
  return `${socketId}::${event}`
}

export function consume(socketId: string, event = '__global'): boolean {
  const limit = PER_EVENT_LIMITS[event] ?? DEFAULT_LIMIT
  const k = key(socketId, event)
  const now = Date.now()
  let bucket = buckets.get(k)
  if (!bucket) {
    bucket = { tokens: limit.capacity, lastRefill: now }
    buckets.set(k, bucket)
  }
  const elapsedSec = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(limit.capacity, bucket.tokens + elapsedSec * limit.refillPerSec)
  bucket.lastRefill = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

export function release(socketId: string): void {
  for (const k of buckets.keys()) {
    if (k.startsWith(`${socketId}::`)) buckets.delete(k)
  }
}
