export type AuditEventType =
  | 'rate_limit_hit'
  | 'invalid_payload'
  | 'origin_rejected'
  | 'auth_failure'
  | 'suspicious_action'

export type AuditEntry = {
  ts: number
  type: AuditEventType
  socketId: string | null
  meta: Record<string, unknown>
}

const MAX_ENTRIES = 1000
const buffer: AuditEntry[] = []

export function audit(type: AuditEventType, socketId: string | null, meta: Record<string, unknown> = {}): void {
  buffer.push({ ts: Date.now(), type, socketId, meta })
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES)
  }
}

export function recent(limit = 100, type?: AuditEventType): AuditEntry[] {
  const slice = type ? buffer.filter(e => e.type === type) : buffer
  return slice.slice(-limit).reverse()
}

export function summary(): Record<AuditEventType, number> {
  const counts: Record<string, number> = {}
  for (const e of buffer) counts[e.type] = (counts[e.type] ?? 0) + 1
  return counts as Record<AuditEventType, number>
}
