import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('each animal row offers Edit and a confirmed, reversible Delete', async ({ page }) => {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Shto të dhënat DEMO' }).click()
  await expect(page.getByText('U shtuan të dhënat DEMO.').or(page.getByRole('status').filter({ hasText: 'DEMO' })).first()).toBeVisible()
  await page.goto('/animals')

  const edit = page.getByRole('link', { name: /^Ndrysho DEMO-001/ })
  const remove = page.getByRole('button', { name: /^Fshi DEMO-001/ })
  for (const control of [edit, remove]) {
    const box = (await control.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await edit.click()
  await expect(page).toHaveURL(/\/animals\/[0-9a-f-]+\/edit$/)
  await expect(page.getByRole('button', { name: 'Ruaj kafshën' })).toBeVisible()
  await page.goBack()

  // Cancel keeps the animal.
  await remove.click()
  const dialog = page.getByRole('alertdialog', { name: 'Ta fshij këtë kafshë?' })
  await expect(dialog).toContainText('DEMO-001')
  await expect(dialog.getByRole('button', { name: 'Anulo' })).toBeFocused()
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([])
  await dialog.getByRole('button', { name: 'Anulo' }).click()
  await expect(dialog).toBeHidden()
  await expect(remove).toBeFocused()

  // Escape also closes without deleting.
  await remove.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('link', { name: /^DEMO-001/ })).toBeVisible()

  // Confirm removes it from the list; the history stays and it can be shown again.
  await remove.click()
  await dialog.getByRole('button', { name: 'Po, fshije' }).click()
  await expect(page.getByRole('link', { name: /^DEMO-001/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Shiko të fshirat (1)' }).click()
  const row = page.getByRole('link', { name: /^DEMO-001/ })
  await expect(row).toContainText('E arkivuar')
  await expect(page.getByRole('button', { name: /^Fshi DEMO-001/ })).toHaveCount(0)
  await row.click()
  await expect(page.getByRole('note')).toContainText('Ndrysho → Statusi → Aktive')
})
