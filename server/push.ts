import { createHash, timingSafeEqual, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { publicKeySchema, testRequestSchema, type PushMessage } from '../src/features/notifications/models.js'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const subscriptionSchema = z.strictObject({
  endpoint: z.url().max(2048).refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname) ||
        url.hostname.endsWith('.push.apple.com'))
  }),
  expirationTime: z.number().positive().nullable().optional(),
  keys: z.strictObject({ p256dh: publicKeySchema, auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
})
type Subscription = z.infer<typeof subscriptionSchema>

export function publicPushKey(env: NodeJS.ProcessEnv) {
  return publicKeySchema.safeParse(env.PUSH_VAPID_PUBLIC_KEY).data ?? null
}

export function reply(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
  })
  response.end(JSON.stringify(body))
}

function pinnedSubscription(value: string | undefined) {
  if (!value || value.length > 4096) return
  try { return subscriptionSchema.safeParse(JSON.parse(value)).data } catch { return }
}

async function requestBody(request: IncomingMessage) {
  if (Number(request.headers['content-length']) > 1024) return
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 1024) return
    chunks.push(bytes)
  }
  try { return testRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data } catch { return }
}

export function createLocalPushHandler(
  env: NodeJS.ProcessEnv,
  send: (subscription: Subscription, message: PushMessage) => Promise<unknown>,
  clock = Date.now,
) {
  const publicKey = publicPushKey(env)
  let subscription = pinnedSubscription(env.PUSH_TEST_SUBSCRIPTION)
  const secret = token.safeParse(env.PUSH_TEST_TOKEN).data
  const subject = env.PUSH_VAPID_SUBJECT
  const origin = env.PUSH_ALLOWED_ORIGIN
  const validOrigin = origin && /^https:\/\/[^/]+$|^http:\/\/127\.0\.0\.1:\d+$/.test(origin) &&
    URL.canParse(origin) && new URL(origin).origin === origin
  const enabled = env.PUSH_LOCAL_TEST === '1' && !env.VERCEL && publicKey && secret && validOrigin &&
    token.safeParse(env.PUSH_VAPID_PRIVATE_KEY).success && subject?.startsWith('mailto:')
  let nextSend = 0
  let sends = 0
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method === 'GET') return reply(response, 200, { publicKey, testEnabled: Boolean(enabled && subscription) })
    if (request.method !== 'POST') return reply(response, 405, { status: 'unavailable' })
    if (!enabled || !secret) return reply(response, 503, { status: 'unavailable' })
    if (request.headers.origin !== origin) return reply(response, 403, { status: 'rejected' })
    const authorization = request.headers.authorization
    if (!authorization || authorization.length !== 50 ||
        !timingSafeEqual(Buffer.from(digest(authorization)), Buffer.from(digest('Bearer ' + secret)))) {
      return reply(response, 401, { status: 'rejected' })
    }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') return reply(response, 415, { status: 'rejected' })
    const input = await requestBody(request)
    if (!input) return reply(response, 400, { status: 'rejected' })
    if (!subscription) return reply(response, 503, { status: 'unavailable' })
    if (input.endpointHash !== digest(subscription.endpoint)) return reply(response, 403, { status: 'rejected' })
    if (subscription.expirationTime && subscription.expirationTime <= clock()) {
      subscription = undefined
      return reply(response, 410, { status: 'expired' })
    }
    if (clock() < nextSend || sends >= 5) return reply(response, 429, { status: 'limited' })
    nextSend = clock() + 60_000
    sends++
    try {
      await send(subscription, { kind: 'test', id: randomUUID(), language: input.language })
      return reply(response, 202, { status: 'accepted' })
    } catch (error) {
      const status = (error as { statusCode?: number } | null)?.statusCode
      if (status === 404 || status === 410) {
        subscription = undefined
        return reply(response, 410, { status: 'expired' })
      }
      return reply(response, 502, { status: 'unavailable' })
    }
  }
}
