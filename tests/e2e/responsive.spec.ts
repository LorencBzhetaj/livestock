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
  for (const [name, url] of destinations) {
    const button = page.getByRole('button', { name: 'Menyja' })
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await button.click()
    const menu = page.getByRole('dialog', { name: 'Menyja' })
    const link = menu.getByRole('navigation', { name: 'Të gjitha faqet' }).getByRole('link', { name })
    await link.scrollIntoViewIfNeeded()
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await link.click()
    await expect(page).toHaveURL(url)
    await expect(menu).toBeHidden()
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

test('the phone menu opens and closes with the keyboard and keeps the page from scrolling', async ({ page }, info) => {
  test.skip(info.project.name === 'desktop', 'Phone layout only')
  await page.goto('/')
  const button = page.getByRole('button', { name: 'Menyja' })
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await button.click()
  const menu = page.getByRole('dialog', { name: 'Menyja' })
  await expect(menu).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mbyll menynë' })).toBeFocused()
  await expect(menu.getByRole('link', { name: 'Kreu' })).toHaveAttribute('aria-current', 'page')
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(button).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('desktop keeps the full sidebar and hides the phone menu button', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop layout only')
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Navigimi kryesor' }).getByRole('link', { name: 'Raporte' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Menyja' })).toBeHidden()
})
