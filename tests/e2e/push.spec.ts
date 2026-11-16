import { expect, test } from '@playwright/test'

const key = 'B' + 'A'.repeat(86)

test('keeps permission and subscription explicit, persists preferences offline, and reports only server acceptance', async ({ context, page }) => {
  await context.addInitScript(() => {
    let permission = 'default'
    let calls = 0
    let attempts = 0
    let current: object | null = null
    const mock = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      unsubscribe: async () => { current = null; return true },
    }
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { get permission() { return permission }, requestPermission() { calls++; permission = 'granted'; return Promise.resolve(permission) } },
    })
    Object.defineProperty(window, 'permissionCalls', { get: () => calls })
    Object.defineProperty(PushManager.prototype, 'getSubscription', { value: async () => current, configurable: true })
    Object.defineProperty(PushManager.prototype, 'subscribe', { value: async () => {
      if (++attempts === 1) throw new Error('Synthetic transient subscription failure')
      current = mock
      return mock
    }, configurable: true })
  })
  let sends = 0
  await page.route('**/api/push', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { publicKey: key, testEnabled: true } })
    const request = route.request().postDataJSON()
    expect(request).toEqual({ endpointHash: expect.stringMatching(/^[a-f0-9]{64}$/), language: 'en' })
    sends++
    return route.fulfill({ status: 202, json: { status: 'accepted' } })
  })
  await page.goto('/settings')
  const notifications = page.getByRole('region', { name: 'Njoftimet', exact: true })
  await expect(notifications.getByText('Kërko leje', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'permissionCalls'))).toBe(0)
  await notifications.getByRole('button', { name: 'Aktivizo njoftimet', exact: true }).click()
  await expect(notifications.getByText('Dhënë', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'permissionCalls'))).toBe(1)
  await notifications.getByRole('button', { name: 'Përfundo konfigurimin' }).click()
  await expect(notifications.getByText('Veprimi për njoftimet nuk u krye.')).toBeVisible()
  await notifications.getByRole('button', { name: 'Përfundo konfigurimin' }).click()
  await expect(notifications.getByText('I abonuar', { exact: true })).toBeVisible()

  await page.getByLabel('Gjuha', { exact: true }).selectOption('en')
  const english = page.getByRole('region', { name: 'Notifications', exact: true })
  await english.getByLabel('Preferred reminder time').fill('16:30')
  await english.getByRole('combobox', { name: 'Preferred notification language' }).selectOption('en')
  await english.getByLabel('Lead time in days').fill('3')
  await english.getByRole('button', { name: 'Save notification preferences' }).click()
  await expect(english.getByText('Notification preferences saved.')).toBeVisible()
  await english.getByLabel('Operator test token').fill('T'.repeat(43))
  await english.getByRole('button', { name: 'Send test notification' }).click()
  await expect(english.getByText(/accepted the test/)).toBeVisible()
  await expect(english.getByRole('button', { name: 'Send test notification' })).toBeDisabled()
  expect(sends).toBe(1)

  await english.getByRole('button', { name: 'Disable notifications' }).click()
  await expect(english.getByText('No subscription', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.unroute('**/api/push')
  await page.reload()
  await expect(english.getByLabel('Preferred reminder time')).toHaveValue('16:30')
  await expect(english.getByLabel('Lead time in days')).toHaveValue('3')
  await expect(english.getByText('Go online to enable or send a test notification.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test('the installed worker handles synthetic push events and suppresses repeat IDs', async ({ context, page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Worker evaluation requires Chromium')
  await page.goto('/settings')
  await expect(page.getByText('Aplikacioni është gati për përdorim pa internet.')).toBeVisible()
  const worker = context.serviceWorkers()[0]
  const calls = await worker.evaluate(async () => {
    const scope = self as unknown as ServiceWorkerGlobalScope
    const shown: unknown[] = []
    Object.defineProperty(scope.registration, 'showNotification', {
      value: async (title: string, options: NotificationOptions) => { shown.push({ title, body: options.body }) },
    })
    Object.defineProperty(scope.registration, 'getNotifications', { value: async () => [] })
    const message = { kind: 'test', id: crypto.randomUUID(), language: 'en' }
    for (const data of [message, message, { ...message, url: 'https://outside.test' }]) {
      const event = new PushEvent('push', { data: JSON.stringify(data) })
      let completion: Promise<unknown> | undefined
      Object.defineProperty(event, 'waitUntil', { value: (pending: Promise<unknown>) => { completion = pending } })
      scope.dispatchEvent(event)
      await completion
    }
    return shown
  })
  expect(calls).toEqual([{ title: 'LivestockOS', body: 'Test notification. Your device is connected.' }])
})

test('handles denied permission without prompting or blocking offline farm navigation', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'denied', requestPermission: () => { throw Error('Unexpected prompt') } },
    })
  })
  await page.goto('/settings')
  await expect(page.getByText('Aplikacioni është gati për përdorim pa internet.')).toBeVisible()
  await expect(page.getByText('Refuzuar', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aktivizo njoftimet', exact: true })).toBeDisabled()
  await context.setOffline(true)
  await page.getByRole('navigation').getByRole('link', { name: 'Kafshët' }).click()
  await expect(page.getByRole('heading', { name: 'Kafshët', exact: true })).toBeVisible()
})
