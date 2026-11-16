/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { openNotification, showTestPush } from './features/notifications/worker'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL(new URL('index.html', self.registration.scope).pathname), {
  denylist: [/\/api(?:\/|$)/],
}))

let pushQueue = Promise.resolve()
self.addEventListener('push', (event) => {
  let input: unknown
  try {
    const payload = event.data?.text()
    if (!payload || payload.length > 512) return
    input = JSON.parse(payload)
  } catch { return }
  const pending = pushQueue.then(async () => {
    const cache = await caches.open('livestockos-push-dedup-v1').catch(() => undefined)
    const key = (id: string) => new URL('.push-receipts/' + id, self.registration.scope).href
    await showTestPush(input, (title, options) => self.registration.showNotification(title, options),
      async (id) => Boolean(await cache?.match(key(id)).catch(() => undefined)) ||
        (await self.registration.getNotifications({ tag: 'livestockos-test-' + id }).catch(() => [])).length > 0,
      async (id) => {
        if (!cache) return
        try {
          await cache.put(key(id), new Response('seen'))
          const keys = await cache.keys()
          await Promise.all(keys.slice(0, Math.max(0, keys.length - 64)).map((entry) => cache.delete(entry)))
        } catch { /* Notification tags still replace an existing visible notification. */ }
      },
    )
  })
  pushQueue = pending.catch(() => undefined)
  event.waitUntil(pushQueue)
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (!event.notification.tag.startsWith('livestockos-test-')) return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) =>
    openNotification(self.registration.scope, windows, (url) => self.clients.openWindow(url)),
  ))
})
