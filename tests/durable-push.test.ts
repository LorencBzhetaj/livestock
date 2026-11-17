import { createECDH, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { createDurablePushHandler } from '../server/durablePush'
import { digest, enrolledSubscription, pushSecrets, selectPublicAddress, supportedProvider } from '../server/pushSecurity'
import { createPushStore, type Transaction } from '../server/pushStore'

let database: PGlite
beforeAll(async () => {
  database = new PGlite()
  await database.exec(await readFile('server/push-schema.sql', 'utf8'))
}, 30_000)
afterAll(async () => { await database?.close() })

const transaction: Transaction = (work) => database.transaction((sql) => work({
  query: (text, values) => sql.query(text, values),
}))
const origin = 'https://private.example.test'
const privateKey = Buffer.alloc(32, 19)
const secrets = pushSecrets(privateKey)
const providerKey = createECDH('prime256v1')
providerKey.generateKeys()
const publicKey = providerKey.getPublicKey().toString('base64url')
const subscription = (id = randomUUID()) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/' + id,
  keys: { p256dh: publicKey, auth: randomBytes(16).toString('base64url') },
})

async function withApi(run: (test: {
  post(body: unknown, cookie?: string, alternate?: boolean, headers?: Record<string, string>): Promise<Response>
  status(cookie?: string): Promise<Response>
  grant(): Promise<string>
  advance(ms: number): void
  deliver: ReturnType<typeof vi.fn<Parameters<typeof createDurablePushHandler>[0]['deliver']>>
}) => Promise<void>) {
  // Test runner executes these cases sequentially on the same embedded PostgreSQL engine.
  await database.exec('TRUNCATE livestock_push_devices,livestock_push_grants,livestock_push_quota,livestock_push_receipts')
  let now = Date.parse('2026-11-17T12:00:00Z')
  const principal = randomUUID()
  const deliver = vi.fn<Parameters<typeof createDurablePushHandler>[0]['deliver']>().mockResolvedValue(201)
  const instance = () => createDurablePushHandler({
    origin, publicKey, secrets, store: createPushStore(transaction, () => now), deliver, clock: () => now,
  })
  const first = instance()
  const second = instance()
  const server = createServer((req, res) => { void (req.url === '/replica' ? second : first)(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing address')
  const url = 'http://127.0.0.1:' + address.port
  try {
    await run({
      post: (body, cookie = '', alternate = false, headers = {}) => fetch(url + (alternate ? '/replica' : '/'), {
        method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      status: (cookie = '') => fetch(url, { headers: { Cookie: cookie } }),
      grant: async () => {
        const code = randomBytes(32).toString('base64url')
        await database.query('INSERT INTO livestock_push_grants (digest,principal_id,expires_at) VALUES ($1,$2,$3)',
          [digest(code), principal, new Date(now + 15 * 60000).toISOString()])
        return code
      },
      advance: (ms) => { now += ms },
      deliver,
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const enroll = (code: string, details = subscription()) => ({ action: 'enroll', code, subscription: details, requestId: randomUUID() })
const endpoints = new Map<string, string>()
const cookieOf = (result: Response, endpoint?: string) => {
  const cookie = result.headers.get('set-cookie')!.split(';')[0]
  if (endpoint) endpoints.set(cookie, endpoint)
  return cookie
}
const testSend = (cookie = '') => ({
  action: 'test', language: 'sq', requestId: randomUUID(), endpointHash: digest(endpoints.get(cookie) ?? 'unknown'),
})

test('enforces consent grants, cookie authorization and same-origin mutation', async () => withApi(async ({ post, grant, status }) => {
  expect((await post(enroll(randomBytes(32).toString('base64url')))).status).toBe(401)
  const request = enroll(await grant())
  expect((await post(request, '', false, { Origin: 'https://other.test' })).status).toBe(403)
  expect((await post({ ...request, subscription: { ...request.subscription, extra: 'x' } })).status).toBe(400)
  const result = await post(request)
  expect(result.status).toBe(200)
  expect(result.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/)
  const cookie = cookieOf(result)
  expect(await (await status(cookie)).json()).toMatchObject({ enrolled: true })
  expect(await (await status(cookie + 'x')).json()).toMatchObject({ enrolled: false })
  expect((await post({ action: 'revoke' })).status).toBe(401)
  expect((await post({ action: 'revoke' }, cookie, false, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
  expect((await post({ action: 'revoke' }, cookie)).status).toBe(200)
  expect((await post({ action: 'revoke' }, cookie)).status).toBe(200)
  expect(await (await status(cookie)).json()).toMatchObject({ enrolled: false })
}))

test('consumes enrollment once while allowing only an exact replay and blocks replacement', async () => withApi(async ({ post, grant }) => {
  const request = enroll(await grant())
  const [first, retry] = await Promise.all([post(request), post(request, '', true)])
  expect([first.status, retry.status]).toEqual([200, 200])
  expect(cookieOf(first)).toBe(cookieOf(retry))
  expect((await post({ ...request, requestId: randomUUID() })).status).toBe(409)
  expect((await post(enroll(await grant(), request.subscription))).status).toBe(409)
  const rows = await database.query<{ sealed_subscription: string }>('SELECT sealed_subscription FROM livestock_push_devices')
  expect(rows.rows).toHaveLength(1)
  expect(rows.rows[0].sealed_subscription).not.toContain(request.subscription.endpoint)
}))

test('reserves delivery and shared rate quotas atomically across replicas', async () => withApi(async ({ post, grant, deliver, advance }) => {
  const a = enroll(await grant())
  const b = enroll(await grant())
  const first = cookieOf(await post(a), a.subscription.endpoint)
  const second = cookieOf(await post(b), b.subscription.endpoint)
  const send = testSend(first)
  expect((await post(testSend(second), first)).status).toBe(409)
  const requests = await Promise.all([post(send, first), post(send, first, true)])
  expect(requests.map(({ status }) => status)).toEqual([202, 202])
  expect((await post(testSend(second), second, true)).status).toBe(429)
  expect(deliver).toHaveBeenCalledTimes(1)
  expect(await (await post(send, first)).json()).toEqual({ status: 'providerAccepted' })
  expect((await post({ ...send, language: 'en' }, first)).status).toBe(409)
  advance(60000)
  deliver.mockRejectedValueOnce(new Error('Network outcome unknown'))
  const unknown = testSend(second)
  expect(await (await post(unknown, second)).json()).toEqual({ status: 'serverAccepted' })
  expect(await (await post(unknown, second, true)).json()).toEqual({ status: 'serverAccepted' })
  expect(deliver).toHaveBeenCalledTimes(2)
}))

test('records provider rejection, cleans up expired subscriptions and rejects expired grants', async () => withApi(async ({ post, grant, deliver, status, advance }) => {
  const request = enroll(await grant())
  const cookie = cookieOf(await post(request), request.subscription.endpoint)
  deliver.mockResolvedValueOnce(302)
  expect((await post(testSend(cookie), cookie)).status).toBe(502)
  advance(60000)
  deliver.mockResolvedValueOnce(410)
  expect((await post(testSend(cookie), cookie)).status).toBe(410)
  expect(await (await status(cookie)).json()).toMatchObject({ enrolled: false })
  expect((await post(testSend(cookie), cookie)).status).toBe(410)
  const code = await grant()
  advance(16 * 60000)
  expect((await post(enroll(code))).status).toBe(401)
  const next = cookieOf(await post(enroll(await grant())))
  advance(31 * 86400_000)
  expect((await post(testSend(), next)).status).toBe(410)
  expect((await database.query('SELECT id FROM livestock_push_devices')).rows).toHaveLength(0)
}))

test('bounds invalid authentication attempts with a shared quota', async () => withApi(async ({ post }) => {
  const attempts = await Promise.all(Array.from({ length: 62 }, (_, index) =>
    post(testSend(), 'invalid', index % 2 === 0)))
  expect(attempts.filter(({ status }) => status === 401)).toHaveLength(60)
  expect(attempts.filter(({ status }) => status === 429)).toHaveLength(2)
}))

test('restricts endpoints, checks real curve keys and rejects nonpublic or mixed DNS answers', () => {
  expect(enrolledSubscription.safeParse(subscription()).success).toBe(true)
  expect(enrolledSubscription.safeParse({ ...subscription(), keys: { ...subscription().keys, p256dh: 'B' + 'A'.repeat(86) } }).success).toBe(false)
  for (const value of ['http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.test/fcm/send/x',
    'https://user@fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:444/fcm/send/x',
    'https://127.1/fcm/send/x', 'https://fcm.googleapis.com/anything', 'https://web.push.apple.com./sample']) {
    expect(supportedProvider(value)).toBe(false)
  }
  expect(supportedProvider('https://web.push.apple.com/sample')).toBe(true)
  expect(selectPublicAddress(['142.250.72.138'])).toBe('142.250.72.138')
  for (const ip of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '100.64.0.1', '::ffff:10.0.0.1', '224.0.0.1']) {
    expect(() => selectPublicAddress(['142.250.72.138', ip])).toThrow()
  }
})
