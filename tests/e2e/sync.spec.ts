import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { expect, test } from '@playwright/test'
import { createSyncHandler } from '../../api/sync'
import { createSyncStore, hash, token } from '../../server/syncStore'
import type { Transaction } from '../../server/pushStore'

test('three browser profiles enroll and exchange records after an offline restart', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This scenario opens desktop, iPhone-sized, and Android-sized contexts together.')
  test.setTimeout(90_000)
  const pg = new PGlite()
  const transaction: Transaction = (work) => pg.transaction((db) => work({ query: (sql, values) => db.query(sql, values) }))
  const handler = createSyncHandler(createSyncStore(transaction), baseURL!)
  const api = createServer((req, res) => { void handler(req, res) })
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = []
  try {
    await pg.exec(await readFile('server/sync-schema.sql', 'utf8'))
    const farm = randomUUID()
    const owner = randomUUID()
    await pg.query('INSERT INTO livestock_sync.farms (id,name) VALUES ($1,$2)', [farm, 'Browser farm'])
    await pg.query('INSERT INTO livestock_sync.identities (id) VALUES ($1)', [owner])
    await pg.query('INSERT INTO livestock_sync.farm_members (farm_id,identity_id) VALUES ($1,$2)', [farm, owner])
    const bootstrap = token()
    await pg.query("INSERT INTO livestock_sync.enrollment (code_digest,farm_id,identity_id,expires_at) VALUES ($1,$2,$3,now()+interval '15 minutes')", [hash(bootstrap), farm, owner])
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
    const address = api.address()
    if (!address || typeof address === 'string') throw new Error('Invalid test address')
    const backend = 'http://127.0.0.1:' + address.port + '/api/sync'
    const anonymous = await fetch(backend, {
      method: 'POST', headers: { origin: baseURL!, 'content-type': 'application/json' },
      body: JSON.stringify({action:'pull',cursor:'0',limit:5}),
    })
    expect(anonymous.status).toBe(401)
    const crossOrigin = await fetch(backend, {
      method: 'POST', headers: { origin: 'https://invalid.example', 'content-type': 'application/json' },
      body: JSON.stringify({action:'session'}),
    })
    expect(crossOrigin.status).toBe(403)
    let dropped = false
    let interrupt = false
    async function profile(width: number, height: number) {
      const context = await browser.newContext({ baseURL, viewport: { width, height }, hasTouch: width < 500 })
      contexts.push(context)
      await context.route('**/api/sync', async (route) => {
        const existing = await context.cookies(baseURL!)
        const cookie = existing.map((item) => item.name + '=' + item.value).join('; ')
        const response = await fetch(backend, {
          method: 'POST', body: route.request().postData(),
          headers: { origin: baseURL!, cookie, 'content-type': 'application/json' },
        })
        if (interrupt && route.request().postDataJSON().action === 'push' && !dropped) {
          dropped = true
          await route.abort('failed')
          return
        }
        const issued = response.headers.get('set-cookie')
        if (issued) {
          const [name, value] = issued.split(';')[0].split('=')
          await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/', secure: true, httpOnly: true }])
        }
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
      })
      const page = await context.newPage()
      await page.goto('/settings')
      await page.getByLabel('Gjuha', { exact: true }).selectOption('en')
      return { context, page }
    }
    async function link(page: typeof desktop.page, label: string, code: string) {
      await page.getByLabel('Device name').fill(label)
      await page.getByLabel('Device enrollment code').fill(code)
      await page.getByRole('button', {name:'Enroll device'}).click()
      await page.getByRole('button', {name:'Confirm reconciliation'}).click()
      await expect(page.getByText('Fully synchronized', {exact:true})).toBeVisible({timeout:15_000})
    }
    const desktop = await profile(1280, 800)
    await link(desktop.page, 'Desktop', bootstrap)
    const invite = async () => {
      await desktop.page.getByRole('button', {name:'Create a code for another device'}).click()
      const code = (await desktop.page.locator('output').textContent())!
      await desktop.page.getByRole('button', {name:'Hide code'}).click()
      return code
    }
    const iphone = await profile(390, 844)
    await link(iphone.page,'iPhone size',await invite())
    const android = await profile(412, 915)
    await link(android.page,'Android size',await invite())
    await expect(desktop.page.getByText('The app is ready for offline use.')).toBeVisible()
    await desktop.context.setOffline(true)
    await desktop.page.getByRole('button', {name:'Add DEMO data'}).click()
    await expect(desktop.page.getByText('Offline',{exact:true}).last()).toBeVisible()
    await desktop.page.close()
    interrupt = true
    await desktop.context.setOffline(false)
    const reopened = await desktop.context.newPage()
    await reopened.goto('/settings')
    await expect(reopened.getByText('Fully synchronized', {exact:true})).toBeVisible({timeout:20_000})
    expect(dropped).toBe(true)
    for (const device of [iphone, android]) {
      await device.page.getByRole('button',{name:'Sync now'}).click()
      await expect(device.page.getByText('Fully synchronized',{exact:true})).toBeVisible()
      await device.page.getByRole('link',{name:'Animals',exact:true}).click()
      await expect(device.page.getByText('DEMO-001',{exact:true})).toBeVisible()
    }
    const stored = await pg.query('SELECT count(*)::int AS total FROM livestock_sync.animals')
    expect(stored.rows[0]).toEqual({total:3})
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()))
    if (api.listening) await new Promise<void>((resolve) => api.close(() => resolve()))
    await pg.close()
  }
})
