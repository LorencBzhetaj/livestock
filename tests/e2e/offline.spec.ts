import { expect, test } from '@playwright/test'

test('installed shell and local records survive offline navigation and reopen', async ({ page, context }) => {
  const remoteRequests: string[] = []
  context.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173/')) remoteRequests.push(request.url())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Përshëndetje, fermer' })).toBeVisible()
  await expect(page.getByText('Nuk ka ende kafshë të regjistruara.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(await manifest.json()).toMatchObject({ display: 'standalone', lang: 'sq' })

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.sync-inline')).toContainText('Pa internet')
  await page.getByRole('link', { name: 'Cilësimet' }).click()
  await page.getByRole('button', { name: 'Shto të dhënat DEMO' }).click()
  await expect(page.getByText('Të dhënat DEMO janë shtuar në këtë pajisje.')).toBeVisible()
  await page.getByLabel('Gjuha', { exact: true }).selectOption('en')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  const settingsUrl = page.url()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(settingsUrl)
  await expect(reopened.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(reopened.getByText('DEMO data has been added on this device.')).toBeVisible()
  await reopened.getByRole('link', { name: 'Overview' }).click()
  await expect(reopened.getByRole('region', { name: 'Active animals' }).getByText('3', { exact: true })).toBeVisible()
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    reopened.viewportSize()!.width,
  )
  expect(remoteRequests).toEqual([])
})
