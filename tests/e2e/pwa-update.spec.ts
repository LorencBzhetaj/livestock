import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { expect, test } from '@playwright/test'

test('installs the app shell and waits for all tabs to close before applying a service worker update', async ({ context }) => {
  const root = resolve('dist')
  let release = 1
  const mime: Record<string, string> = {
    js: 'text/javascript', html: 'text/html', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json',
  }
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const file = resolve(root, '.' + (path.includes('.') ? path : '/index.html'))
      if (!file.startsWith(root + sep)) { response.writeHead(404).end(); return }
      const content = await readFile(file)
      response.setHeader('Content-Type', mime[file.split('.').pop() ?? ''] ?? 'application/octet-stream')
      response.setHeader('Cache-Control', 'no-cache')
      if (path === '/sw.js') response.end(Buffer.concat([content, Buffer.from('\n// Synthetic release ' + release)]))
      else response.end(content)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Loopback address unavailable')
    const origin = 'http://127.0.0.1:' + address.port
    const page = await context.newPage()
    await page.goto(origin + '/settings')
    await expect(page.getByText('Aplikacioni është gati për përdorim pa internet.')).toBeVisible()
    await page.getByRole('button', { name: 'Shto të dhënat DEMO' }).click()
    await expect(page.getByText('Të dhënat DEMO janë shtuar në këtë pajisje.')).toBeVisible()
    const manifest = await (await page.request.get(origin + '/manifest.webmanifest')).json()
    expect(manifest).toMatchObject({ id: './', start_url: './', scope: './', display: 'standalone' })
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]))
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180')
    const icon = await (await page.request.get(origin + '/apple-touch-icon.png')).body()
    expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([180, 180])

    const peer = await context.newPage()
    await peer.goto(origin + '/settings')
    await expect(peer.getByText('Aplikacioni është gati për përdorim pa internet.')).toBeVisible()
    await page.goto(origin + '/animals/new')
    await page.getByLabel('Etiketa e veshit').fill('SYNTHETIC-DRAFT')
    let navigated = false
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigated = true })
    release = 2
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update()
    })
    await expect(page.getByText(/Një përditësim është gati/)).toBeVisible()
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed')
    expect(navigated).toBe(false)
    await expect(page.getByLabel('Etiketa e veshit')).toHaveValue('SYNTHETIC-DRAFT')
    await page.getByRole('combobox', { name: 'Gjinia', exact: true }).selectOption('female')
    await page.getByRole('button', { name: 'Ruaj kafshën' }).click()
    await expect(page.getByRole('heading', { name: 'SYNTHETIC-DRAFT' })).toBeVisible()
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed')
    expect(navigated).toBe(true) // The save navigates normally after preserving the draft.
    await page.close()
    await expect.poll(() => peer.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration())?.waiting?.state,
    )).toBe('installed')
    await peer.close()

    const reopened = await context.newPage()
    await reopened.goto(origin + '/animals')
    await expect.poll(() => reopened.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return !!navigator.serviceWorker.controller && !registration?.waiting && !registration?.installing
    })).toBe(true)
    await context.setOffline(true)
    await reopened.reload()
    await expect(reopened.getByRole('link', { name: /SYNTHETIC-DRAFT/ })).toBeVisible()
    await expect(reopened.getByRole('link', { name: /DEMO-003/ })).toBeVisible()
    await reopened.close()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
})
