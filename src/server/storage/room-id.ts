import { randomUUID } from 'node:crypto'

export function generateRoomId(): string {
  return randomUUID().slice(0, 6).toUpperCase()
}

export async function generateUniqueRoomId(
  exists: (id: string) => boolean | Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generateRoomId()
    if (!(await exists(id))) return id
  }
  throw new Error('ROOM_ID_GENERATION_FAILED')
}
