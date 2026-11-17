import { expect, test } from '@playwright/test'

test('enrolls, checks the same authorized test request, and revokes without disrupting offline access', async ({ page, context }) => {
  await context.addInitScript(() => {
    let current: object | null = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic' }),
      unsubscribe: async () => { current = null; return true },
    }
    Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: 'granted' } })
    Object.defineProperty(PushManager.prototype, 'getSubscription', { configurable: true, value: async () => current })
  })
  let enrolled = false
  let firstId: string | undefined
  await page.route('**/api/push', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({
      json: { publicKey: 'B' + 'A'.repeat(86), testEnabled: true, enrollmentEnabled: true, enrolled },
    })
    const body = route.request().postDataJSON()
    if (body.action === 'enroll') {
      expect(body.code).toHaveLength(43)
      enrolled = true
      return route.fulfill({ json: { status: 'enrolled' } })
    }
    if (body.action === 'revoke') {
      enrolled = false
      return route.fulfill({ json: { status: 'revoked' } })
    }
    expect(body.endpointHash).toMatch(/^[a-f0-9]{64}$/)
    if (!firstId) {
      firstId = body.requestId
      return route.fulfill({ status: 202, json: { status: 'serverAccepted' } })
    }
    expect(body.requestId).toBe(firstId)
    return route.fulfill({ status: 202, json: { status: 'providerAccepted' } })
  })
  await page.goto('/settings')
  await expect(page.getByText('Aplikacioni është gati për përdorim pa internet.')).toBeVisible()
  await page.getByLabel('Kodi njëpërdorimësh i regjistrimit').fill('A'.repeat(43))
  await page.getByRole('button', { name: 'Regjistro këtë pajisje' }).click()
  await expect(page.getByRole('definition').filter({ hasText: /^E regjistruar$/ })).toBeVisible()
  await page.getByLabel('Gjuha', { exact: true }).selectOption('en')
  await page.getByRole('button', { name: 'Send test notification' }).click()
  await expect(page.getByText(/The server accepted the request/)).toBeVisible()
  await page.getByRole('button', { name: 'Check last test request' }).click()
  await expect(page.getByText(/The provider accepted the request. Device delivery is unverified/)).toBeVisible()
  await page.getByRole('button', { name: 'Revoke server enrollment' }).click()
  await expect(page.getByText('Server enrollment revoked.', { exact: true })).toBeVisible()
  await expect(page.getByText('No subscription', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.unroute('**/api/push')
  await page.getByRole('link', { name: 'Animals', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Animals', exact: true })).toBeVisible()
})
