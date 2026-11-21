import { pushMessageSchema } from './models'

export async function showTestPush(
  input: unknown,
  show: (title: string, options: NotificationOptions) => Promise<void>,
  seen: (id: string) => Promise<boolean>,
  remember: (id: string) => Promise<void>,
) {
  const message = pushMessageSchema.safeParse(input)
  if (!message.success || await seen(message.data.id)) return
  const { id, language, kind } = message.data
  await show('LivestockOS', {
    body: kind==='reminder' ? (language==='sq'?'Ke kujtesa për fermën. Hap kalendarin për t’i parë.':'You have farm reminders. Open your calendar to review them.') : language === 'sq' ? 'Njoftim prove. Pajisja juaj është lidhur.' : 'Test notification. Your device is connected.',
    tag: 'livestockos-test-' + id,
    data: {path:kind==='reminder'?'tasks':'settings'},
  })
  await remember(id)
}

export async function openNotification(
  scope: string, windows: readonly { url: string; focus(): Promise<unknown>;navigate?(url:string):Promise<unknown> }[],
  open: (url: string) => Promise<unknown>, path='settings',
) {
  const root = new URL(scope)
  const page = windows.find((window) => {
    const url = new URL(window.url)
    return url.origin === root.origin && url.pathname.startsWith(root.pathname)
  })
  if (page) {
    try { if(path==='tasks'&&page.navigate)await page.navigate(new URL('tasks',root).href);await page.focus(); return } catch { /* The window may have closed. */ }
  }
  await open(new URL(path==='tasks'?'tasks':'settings', root).href)
}
