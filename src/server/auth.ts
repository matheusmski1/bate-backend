import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
const COOKIE_NAME = 'bate_session'

function getSecret(): string {
  const fromEnv = process.env.JWT_SECRET
  if (fromEnv && fromEnv.length >= 32) return fromEnv
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a 32+ char string in production')
  }
  return 'dev-only-secret-do-not-use-in-prod-1234567890abcdef'
}

export type GuestClaims = {
  sub: string
  kind: 'guest'
  iat: number
  exp: number
}

export function signGuestToken(playerId?: string): { token: string; playerId: string; expiresAt: number } {
  const sub = playerId ?? randomUUID()
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + TOKEN_TTL_SECONDS
  const token = jwt.sign({ sub, kind: 'guest' as const }, getSecret(), { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS })
  return { token, playerId: sub, expiresAt: exp * 1000 }
}

export function verifyToken(token: string): GuestClaims | null {
  try {
    const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] }) as Record<string, unknown>
    if (typeof decoded.sub !== 'string') return null
    if (decoded.kind !== 'guest') return null
    return decoded as unknown as GuestClaims
  } catch {
    return null
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = decodeURIComponent(part.slice(idx + 1).trim())
    if (k) out[k] = v
  }
  return out
}

function domainApplies(reqHost: string | undefined, domain: string): boolean {
  if (!reqHost) return false
  const norm = domain.startsWith('.') ? domain.slice(1) : domain
  return reqHost === norm || reqHost.endsWith(`.${norm}`)
}

export function sessionCookie(
  token: string,
  opts: { secure: boolean; domain?: string; requestHost?: string },
): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${TOKEN_TTL_SECONDS}`,
  ]
  if (opts.secure) {
    parts.push('SameSite=None')
    parts.push('Secure')
  } else {
    parts.push('SameSite=Lax')
  }
  if (opts.domain && domainApplies(opts.requestHost, opts.domain)) {
    parts.push(`Domain=${opts.domain}`)
  }
  return parts.join('; ')
}

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  const cookies = parseCookies(cookieHeader)
  return cookies[COOKIE_NAME] ?? null
}

export { COOKIE_NAME }
