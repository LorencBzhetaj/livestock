import { expect, test, type Page } from '@playwright/test'

const destinations = [
  ['Vaksinimet', /\/vaccinations$/],
  ['Detyrat', /\/tasks\?view=list$/],
  ['Raporte', /\/reports$/],
  ['Backup', /\/backup$/],
] as const

async function reachEveryPage(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Përshëndetje, fermer' })).toBeVisible()
  const bottom = page.getByRole('navigation', { name: 'Navigimi kryesor' })
  await expect(bottom.getByRole('link', { name: 'Kreu' })).toBeVisible()
  const more = page.getByRole('navigation', { name: 'Më shumë faqe' })
  for (const [name, url] of destinations) {
    const link = more.getByRole('link', { name })
    await link.scrollIntoViewIfNeeded()
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await link.click()
    await expect(page).toHaveURL(url)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('every page is reachable from phone navigation with touch-sized links', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone layout only')
  await reachEveryPage(page)
  await page.goto('/veterinary')
  for (const name of ['Veterinaria', 'Vaksinimet']) {
    const view = page.getByRole('navigation', { name: 'Pamjet veterinare' }).getByRole('link', { name })
    expect((await view.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
})

test('a phone held in landscape keeps the bottom navigation instead of a clipped sidebar', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone layout only')
  await page.setViewportSize({ width: 844, height: 390 })
  await reachEveryPage(page)
})

test('desktop keeps the full sidebar and hides the phone shortcuts', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop layout only')
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Navigimi kryesor' }).getByRole('link', { name: 'Raporte' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Më shumë faqe' })).toBeHidden()
})
