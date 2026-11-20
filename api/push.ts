import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { publicPushKey, reply } from '../server/push.js'
import { createDurablePushHandler } from '../server/durablePush.js'
import { postgresTransactions } from '../server/pushDatabase.js'
import { createPushStore } from '../server/pushStore.js'
import { deliverPush } from '../server/deliverPush.js'
import { createAuthStore, readCookie } from '../server/authStore.js'
import { pushSecrets, tokenSchema } from '../server/pushSecurity.js'

function configure(env: NodeJS.ProcessEnv) {
  if (env.PUSH_DURABLE_TEST !== '1' || env.VERCEL_ENV === 'production') return
  const publicKey = publicPushKey(env)
  const privateKey = tokenSchema.safeParse(env.PUSH_VAPID_PRIVATE_KEY).data
  const secret = tokenSchema.safeParse(env.PUSH_SERVER_KEY).data
  const subject = env.PUSH_VAPID_SUBJECT
  const origin = env.PUSH_ALLOWED_ORIGIN
  const connection = env.PUSH_DATABASE_URL
  if (!publicKey || !privateKey || !secret || Buffer.from(secret, 'base64url').toString('base64url') !== secret ||
      !subject?.startsWith('mailto:') || !z.email().safeParse(subject.slice(7)).success ||
      !origin || !URL.canParse(origin) || new URL(origin).origin !== origin || !origin.startsWith('https://') ||
      !connection || !URL.canParse(connection)) return
  const database = new URL(connection)
  if (database.protocol !== 'postgresql:' || database.searchParams.get('sslmode') !== 'verify-full') return
  return createDurablePushHandler({
    origin, publicKey, secrets: pushSecrets(Buffer.from(secret, 'base64url')),
    store: createPushStore(postgresTransactions(connection)),
    deliver: (subscription, message) => deliverPush(subscription, message, { subject, publicKey, privateKey }),
  })
}

const durable = configure(process.env)

const accountStore = process.env.AUTH_ENABLED === '1' && process.env.SYNC_DATABASE_URL
  ? createAuthStore(postgresTransactions(process.env.SYNC_DATABASE_URL)) : undefined

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (accountStore && request.method === 'POST') {
    try {
      const token = readCookie(request.headers.cookie)
      const actor = token && await accountStore.session(token)
      if (!actor) return reply(response, 401, {status:'unauthorized'})
      if (actor.role !== 'ADMIN') return reply(response, 403, {status:'forbidden'})
    } catch { return reply(response, 503, {status:'unavailable'}) }
  }
  if (durable) return durable(request, response)
  if (request.method === 'GET') return reply(response, 200, { publicKey: publicPushKey(process.env), testEnabled: false })
  return reply(response, request.method === 'POST' ? 503 : 405, { status: 'unavailable' })
}
