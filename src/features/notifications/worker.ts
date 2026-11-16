import { pushMessageSchema } from './models'

export async function showTestPush(
  input: unknown,
  show: (title: string, options: NotificationOptions) => Promise<void>,
  seen: (id: string) => Promise<boolean>,
  remember: (id: string) => Promise<void>,
) {
  const message = pushMessageSchema.safeParse(input)
  if (!message.success || await seen(message.data.id)) return
  const { id, language } = message.data
  await show('LivestockOS', {
    body: language === 'sq' ? 'Njoftim prove. Pajisja juaj është lidhur.' : 'Test notification. Your device is connected.',
    tag: 'livestockos-test-' + id,
  })
  await remember(id)
}

export async function openNotification(
  scope: string, windows: readonly { url: string; focus(): Promise<unknown> }[],
  open: (url: string) => Promise<unknown>,
) {
  const root = new URL(scope)
  const page = windows.find((window) => {
    const url = new URL(window.url)
    return url.origin === root.origin && url.pathname.startsWith(root.pathname)
  })
  if (page) {
    try { await page.focus(); return } catch { /* The window may have closed. */ }
  }
  await open(new URL('settings', root).href)
}
