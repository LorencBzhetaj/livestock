import { createHash, randomUUID } from 'node:crypto'
import { createServer, type RequestListener } from 'node:http'
import { expect, test, vi } from 'vitest'
import { createLocalPushHandler } from '../server/push'
import serverless from '../api/push'
import { capabilities, requestNotificationPermission, subscribeDevice } from '../src/features/notifications/client'
import { openNotification, showTestPush } from '../src/features/notifications/worker'
import { settingSchema } from '../src/db/models'

const key = 'B' + 'A'.repeat(86)
const token = 'T'.repeat(43)
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic'
const origin = 'https://example.test'
const env = {
  PUSH_LOCAL_TEST: '1', PUSH_VAPID_PUBLIC_KEY: key, PUSH_VAPID_PRIVATE_KEY: 'P'.repeat(43),
  PUSH_VAPID_SUBJECT: 'mailto:operator@example.test', PUSH_TEST_TOKEN: token, PUSH_ALLOWED_ORIGIN: origin,
  PUSH_TEST_SUBSCRIPTION: JSON.stringify({ endpoint, expirationTime: null, keys: { p256dh: key, auth: 'A'.repeat(22) } }),
}

async function withServer(
  handler: RequestListener,
  testCase: (url: string) => Promise<void>,
) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing address')
    await testCase('http://127.0.0.1:' + address.port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const payload = { endpointHash: createHash('sha256').update(endpoint).digest('hex'), language: 'sq' }
const post = (url: string, body: object = payload, headers: Record<string, string> = {}) => fetch(url, {
  method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

test('identifies unsupported sessions and prompts only from the explicit permission call', async () => {
  const flags = { secure: true, standalone: false, notification: true, push: true, registration: true }
  expect(capabilities(flags).supported).toBe(true)
  expect(capabilities({ ...flags, secure: false }).supported).toBe(false)
  expect(capabilities({ ...flags, notification: false }).supported).toBe(false)
  expect(capabilities({ ...flags, push: false }).supported).toBe(false)
  const ask = vi.fn(async () => 'granted' as const)
  expect(ask).not.toHaveBeenCalled()
  for (const permission of ['denied', 'granted'] as const) {
    expect(await requestNotificationPermission({ permission, requestPermission: ask })).toBe(permission)
  }
  expect(ask).not.toHaveBeenCalled()
  expect(await requestNotificationPermission({ permission: 'default', requestPermission: ask })).toBe('granted')
  expect(ask).toHaveBeenCalledTimes(1)
  const subscribe = vi.fn<PushManager['subscribe']>()
  subscribeDevice({ subscribe }, key)
  expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) })
})

test('only permits bounded, authorized requests for the pinned destination and limits sending', async () => {
  const send = vi.fn(async () => undefined)
  let now = 100_000
  await withServer(createLocalPushHandler(env, send, () => now), async (url) => {
    const config = await fetch(url)
    expect(await config.json()).toEqual({ publicKey: key, testEnabled: true })
    expect(config.headers.get('cache-control')).toBe('no-store')
    expect((await post(url, payload, { Origin: 'https://bad.example' })).status).toBe(403)
    expect((await post(url, payload, { Authorization: 'Bearer ' + 'X'.repeat(43) })).status).toBe(401)
    expect((await post(url, { ...payload, endpoint })).status).toBe(400)
    expect((await post(url, { ...payload, padding: 'A'.repeat(1500) })).status).toBe(400)
    expect((await post(url, { ...payload, endpointHash: 'a'.repeat(64) })).status).toBe(403)
    expect(send).not.toHaveBeenCalled()
    const pair = await Promise.all([post(url), post(url)])
    expect(pair.map(({ status }) => status).sort()).toEqual([202, 429])
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ endpoint }), {
      kind: 'test', id: expect.any(String), language: 'sq',
    })
    for (let i = 0; i < 4; i++) {
      now += 60_000
      expect((await post(url)).status).toBe(202)
    }
    now += 60_000
    expect((await post(url)).status).toBe(429)
    expect(send).toHaveBeenCalledTimes(5)
  })
})

test('fails closed on serverless and unusable destinations and invalidates expired peers', async () => {
  const send = vi.fn(async () => { throw { statusCode: 410 } })
  await withServer(createLocalPushHandler(env, send), async (url) => {
    expect((await post(url)).status).toBe(410)
    expect((await post(url)).status).toBe(503)
    expect(await (await fetch(url)).json()).toMatchObject({ testEnabled: false })
  })
  await withServer(createLocalPushHandler({ ...env, VERCEL: '1' }, send), async (url) => {
    expect((await post(url)).status).toBe(503)
  })
  const target = env.PUSH_TEST_SUBSCRIPTION.replace('fcm.googleapis.com', '127.0.0.1')
  await withServer(createLocalPushHandler({ ...env, PUSH_TEST_SUBSCRIPTION: target }, send), async (url) => {
    expect((await post(url)).status).toBe(503)
  })
  await withServer(serverless, async (url) => {
    expect((await post(url)).status).toBe(503)
    expect(await (await fetch(url)).json()).toMatchObject({ testEnabled: false })
  })
  expect(send).toHaveBeenCalledTimes(1)
})

test('shows only fixed bilingual push text, deduplicates, and routes clicks within scope', async () => {
  const displayed = vi.fn(async () => undefined)
  const seen = new Set<string>()
  const emit = (value: unknown) => showTestPush(value, displayed, async (id) => seen.has(id), async (id) => { seen.add(id) })
  const message = { kind: 'test', id: randomUUID(), language: 'sq' }
  await emit({ ...message, url: 'https://bad.example' })
  await emit(message)
  await emit(message)
  await emit({ ...message, id: randomUUID(), language: 'en' })
  expect(displayed).toHaveBeenCalledTimes(2)
  expect(displayed).toHaveBeenNthCalledWith(1, 'LivestockOS', expect.objectContaining({ body: expect.stringContaining('Njoftim prove') }))
  expect(displayed).toHaveBeenNthCalledWith(2, 'LivestockOS', expect.objectContaining({ body: expect.stringContaining('Test notification') }))
  const focus = vi.fn(async () => undefined)
  const open = vi.fn(async () => undefined)
  await openNotification('https://example.test/app/', [{ url: 'https://outside.test/app/', focus }], open)
  expect(focus).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledWith('https://example.test/app/settings')
  await openNotification('https://example.test/app/', [{ url: 'https://example.test/app/animals/new', focus }], open)
  expect(focus).toHaveBeenCalledTimes(1)
  const setting = { key: 'notificationPreferences', updatedAt: '2026-01-01T00:00:00.000Z' }
  expect(settingSchema.safeParse({ ...setting, value: { language: 'sq', reminderTime: '18:00', leadDays: 3 } }).success).toBe(true)
  expect(settingSchema.safeParse({ ...setting, value: { language: 'sq', reminderTime: '25:00', leadDays: 3 } }).success).toBe(false)
})
