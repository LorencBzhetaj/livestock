import { z, type ZodType } from 'zod'
import { pageSchema, resultSchema, sessionSchema, type SyncRequest } from './protocol'

export class SyncHttpError extends Error {
  constructor(readonly status: number) { super('Sync request failed') }
}

export async function request<T>(input: SyncRequest, schema: ZodType<T>): Promise<T> {
  const body = JSON.stringify(input)
  if (new TextEncoder().encode(body).byteLength > 3 * 1024 * 1024) throw new Error('Synchronization request too large')
  const response = await fetch('/api/sync', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new SyncHttpError(response.status)
  return schema.parse(await response.json())
}

export const getSession = () => request({ action: 'session' }, sessionSchema)
export const pull = (cursor: string) => request({ action: 'pull', cursor, limit: 100 }, pageSchema)
export const push = (operation: Extract<SyncRequest, { action: 'push' }>['operation']) => request({ action: 'push', operation }, resultSchema)
export const enroll = (code: string, label: string) => request({ action: 'enroll', code, label }, sessionSchema)
export const invite = () => request({ action: 'invite' }, z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }))
export const revoke = (deviceId: string) => request({ action: 'revoke', deviceId }, z.object({ revoked: z.literal(true) }))
