import type { Plugin } from 'vite'
import { sendNotification } from 'web-push'
import { createLocalPushHandler, reply } from './push.js'

export function previewPush(): Plugin {
  return {
    name: 'livestockos-local-push',
    configurePreviewServer(server) {
      const env = process.env
      const handler = createLocalPushHandler(env, (subscription, message) => sendNotification(
        subscription, JSON.stringify(message), {
          TTL: 60, timeout: 10_000, topic: 'livestockos-test',
          vapidDetails: {
            subject: env.PUSH_VAPID_SUBJECT!, publicKey: env.PUSH_VAPID_PUBLIC_KEY!, privateKey: env.PUSH_VAPID_PRIVATE_KEY!,
          },
        },
      ))
      server.middlewares.use('/api/push', (request, response) => {
        void handler(request, response).catch(() => {
          if (!response.headersSent) reply(response, 503, { status: 'unavailable' })
        })
      })
    },
  }
}
