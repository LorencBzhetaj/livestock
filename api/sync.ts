import type { IncomingMessage, ServerResponse } from 'node:http'
import { requestSchema } from '../src/features/sync/protocol.js'
import { postgresTransactions } from '../server/pushDatabase.js'
import { createSyncStore } from '../server/syncStore.js'
import { reply } from '../server/push.js'

const cookieName = '__Host-livestock-sync'
const maxBody = 3 * 1024 * 1024
const credential = /^[A-Za-z0-9_-]{43}$/

async function readRequest(request: IncomingMessage, limit: number) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json'
    || Number(request.headers['content-length']) > limit) return undefined
  const chunks: Buffer[] = []
  let count = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const data = Buffer.from(chunk)
    count += data.length
    if (count > limit) return undefined
    chunks.push(data)
  }
  try { return requestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data }
  catch { return undefined }
}

export function createSyncHandler(store: ReturnType<typeof createSyncStore>, origin: string) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') return reply(response, 405, { error: 'method' })
    if (request.headers.origin !== origin ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
      return reply(response, 403, { error: 'origin' })
    }
    try {
      const secret = request.headers.cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith(cookieName + '='))?.slice(cookieName.length + 1)
      const authenticatedShape = secret && credential.test(secret)
      const input = await readRequest(request, authenticatedShape ? maxBody : 4096)
      if (!input) return reply(response, 400, { error: 'invalid' })
      if (input.action === 'push' && input.operation.mutations.some((item) =>
        Buffer.byteLength(JSON.stringify(item.payload)) > 24_000)) return reply(response, 413, { error: 'recordSize' })
      if (input.action === 'enroll') {
        const result = await store.enroll(input.code, input.label)
        if (!result) return reply(response, 401, { error: 'authorization' })
        if ('limited' in result) return reply(response, 429, { error: 'limited' })
        response.setHeader('Set-Cookie', cookieName + '=' + result.secret + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000')
        return reply(response, 200, result.session)
      }
      if (!secret || !authenticatedShape) return reply(response, 401, { error: 'authorization' })
      const result = await store.authorized<object | undefined>(secret, async (sql, device) => {
        switch (input.action) {
          case 'session': return { farmId: device.farm_id, identityId: device.identity_id, deviceId: device.id, name: device.name }
          case 'devices': return { devices: await store.devices(sql, device) }
          case 'invite': return await store.invite(sql, device)
          case 'revoke': return await store.revoke(sql, device, input.deviceId)
          case 'pull': return await store.pull(sql, device, input.cursor, input.limit)
          case 'push': return await store.push(sql, device, input.operation)
        }
      })
      if ('unauthorized' in result) return reply(response, 401, { error: 'authorization' })
      if ('limited' in result) return reply(response, 429, { error: 'limited' })
      if (!result.value) return reply(response, input.action === 'invite' ? 429 : 409, { error: 'rejected' })
      return reply(response, 200, result.value)
    } catch {
      return reply(response, 503, { error: 'unavailable' })
    }
  }
}

function configure(env: NodeJS.ProcessEnv) {
  if (env.SYNC_ENABLED !== '1' || env.VERCEL_ENV !== 'preview' || !env.SYNC_DATABASE_URL || !env.SYNC_ALLOWED_ORIGIN) return
  try {
    const db = new URL(env.SYNC_DATABASE_URL)
    const origin = new URL(env.SYNC_ALLOWED_ORIGIN)
    if (origin.protocol !== 'https:' || origin.origin !== env.SYNC_ALLOWED_ORIGIN || db.protocol !== 'postgresql:'
      || db.searchParams.get('sslmode') !== 'verify-full' || db.username !== 'livestock_sync_runtime') return
    return createSyncHandler(createSyncStore(postgresTransactions(db.href)), origin.origin)
  } catch { return undefined }
}

const enabled = configure(process.env)
export default function handler(request: IncomingMessage, response: ServerResponse) {
  return enabled ? enabled(request, response) : reply(response, 503, { error: 'unavailable' })
}
