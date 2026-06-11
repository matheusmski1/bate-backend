import { io, type Socket } from 'socket.io-client'

export const ORIGIN = 'http://localhost:3000'
export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function waitForHealth(base: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await delay(500)
  }
  throw new Error('server nao subiu')
}

export async function guestSession(base: string): Promise<{ playerId: string; cookie: string }> {
  const res = await fetch(`${base}/auth/guest`)
  const body = (await res.json()) as { playerId: string }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  const cookie = (setCookies[0] ?? '').split(';')[0] ?? ''
  return { playerId: body.playerId, cookie }
}

export function connect(base: string, cookie: string): Promise<Socket> {
  const socket = io(base, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Cookie: cookie, Origin: ORIGIN },
  })
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 8000)
    socket.once('connect', () => { clearTimeout(t); resolve(socket) })
    socket.once('connect_error', err => { clearTimeout(t); reject(err) })
  })
}

export function emitAck(socket: Socket, event: string, payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 8000)
    socket.emit(event, payload, (res: unknown) => { clearTimeout(t); resolve(res) })
  })
}

export function waitForEvent(socket: Socket, event: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`evento "${event}" nao chegou em ${timeoutMs}ms`)), timeoutMs)
    socket.once(event, (payload: unknown) => { clearTimeout(t); resolve(payload) })
  })
}

export function waitForRoomState(
  socket: Socket,
  predicate: (state: any) => boolean,
  timeoutMs: number,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const onState = (payload: { state: any }) => {
      if (!predicate(payload.state)) return
      clearTimeout(t)
      socket.off('room:state', onState)
      resolve(payload)
    }
    const t = setTimeout(() => {
      socket.off('room:state', onState)
      reject(new Error(`room:state satisfazendo a condicao nao chegou em ${timeoutMs}ms`))
    }, timeoutMs)
    socket.on('room:state', onState)
  })
}
