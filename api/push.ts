import type { IncomingMessage, ServerResponse } from 'node:http'
import { publicPushKey, reply } from '../server/push.js'

export default function handler(request: IncomingMessage, response: ServerResponse) {
  // Serverless replicas cannot enforce a process-local test quota.
  if (request.method === 'GET') return reply(response, 200, { publicKey: publicPushKey(process.env), testEnabled: false })
  return reply(response, request.method === 'POST' ? 503 : 405, { status: 'unavailable' })
}
