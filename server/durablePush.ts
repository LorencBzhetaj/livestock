import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { notificationLanguage, type PushMessage } from '../src/features/notifications/models.js'
import { reply } from './push.js'
import { digest, enrolledSubscription, pushSecrets, tokenSchema, type EnrolledSubscription } from './pushSecurity.js'
import type { PushStore } from './pushStore.js'

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('enroll'), code: tokenSchema, requestId: z.uuid(), subscription: enrolledSubscription }),
  z.strictObject({ action: z.literal('revoke') }),
  z.strictObject({ action: z.literal('test'), requestId: z.uuid(), language: notificationLanguage, endpointHash: z.string().regex(/^[a-f0-9]{64}$/) }),
])

async function readBody(request: IncomingMessage) {
  if (Number(request.headers['content-length']) > 4096 || request.headers['content-type']?.split(';')[0] !== 'application/json') return
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > 4096) return
    chunks.push(bytes)
  }
  try { return bodySchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).data } catch { return }
}

export function createDurablePushHandler(options: {
  origin: string; publicKey: string; secrets: ReturnType<typeof pushSecrets>; store: PushStore;
  deliver(subscription: EnrolledSubscription, message: PushMessage): Promise<number>;
  clock?: () => number;
}) {
  const clock = options.clock ?? Date.now
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      if (request.method === 'GET') {
        const deviceId = options.secrets.authenticate(request.headers.cookie)
        const status = await options.store.status(deviceId)
        return reply(response, 200, { publicKey: options.publicKey, testEnabled: true, enrollmentEnabled: true, ...status })
      }
      if (request.method !== 'POST') return reply(response, 405, { status: 'rejected' })
      if (request.headers.origin !== options.origin ||
          (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
        return reply(response, 403, { status: 'rejected' })
      }
      const deviceId = options.secrets.authenticate(request.headers.cookie)
      const input = await readBody(request)
      const result = await options.store.operate(!input ? { kind: 'invalid' } : input.action === 'enroll' ? {
        kind: 'enroll', deviceId, grant: digest(input.code), requestId: input.requestId,
        payloadHash: digest(JSON.stringify(input.subscription)), endpointHash: digest(input.subscription.endpoint),
        expires: Math.min(input.subscription.expirationTime ?? Infinity, clock() + 30 * 86400_000),
        seal: (id) => options.secrets.seal(id, input.subscription),
      } : input.action === 'revoke' ? { kind: 'revoke', deviceId } : { ...input, kind: 'test', deviceId })
      if (result.kind === 'enrolled' || result.kind === 'revoked') {
        response.setHeader('Set-Cookie', options.secrets.cookie(result.kind === 'enrolled' ? result.id : undefined))
        return reply(response, 200, { status: result.kind })
      }
      if (result.kind === 'send' && input?.action === 'test') {
        let outcome: 'providerAccepted' | 'providerRejected' | 'expired' = 'providerRejected'
        let status: number
        try {
          status = await options.deliver(options.secrets.open(result.device.id, result.device.sealed_subscription),
            { kind: 'test', id: input.requestId, language: input.language })
        } catch {
          // A timeout has unknown delivery. Retain the reservation and never resend this request ID.
          return reply(response, 202, { status: 'serverAccepted' })
        }
        if (status >= 200 && status < 300) outcome = 'providerAccepted'
        if (status === 404 || status === 410) outcome = 'expired'
        await options.store.complete(result.device.id, input.requestId, outcome)
        return reply(response, outcome === 'expired' ? 410 : outcome === 'providerAccepted' ? 202 : 502, { status: outcome })
      }
      if (result.kind !== 'send') {
        const statuses = {
          unauthorized: 401, rejected: 400, limited: 429, conflict: 409, expired: 410,
          serverAccepted: 202, providerAccepted: 202, providerRejected: 502,
        }
        return reply(response, statuses[result.kind], { status: result.kind })
      }
      return reply(response, 503, { status: 'unavailable' })
    } catch {
      return reply(response, 503, { status: 'unavailable' })
    }
  }
}
