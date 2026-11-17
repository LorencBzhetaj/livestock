import { Resolver } from 'node:dns/promises'
import { request } from 'node:https'
import * as webPush from 'web-push'
import type { PushMessage } from '../src/features/notifications/models.js'
import { selectPublicAddress, supportedProvider, type EnrolledSubscription } from './pushSecurity.js'

export async function deliverPush(subscription: EnrolledSubscription, message: PushMessage, vapid: webPush.VapidKeys & { subject: string }) {
  if (!supportedProvider(subscription.endpoint)) throw new Error('Unsupported destination')
  const endpoint = new URL(subscription.endpoint)
  const resolver = new Resolver({ timeout: 2500, tries: 1 })
  const address = selectPublicAddress(await resolver.resolve4(endpoint.hostname))
  const details = webPush.generateRequestDetails(subscription, JSON.stringify(message), {
    TTL: 60, topic: 'livestockos-test', timeout: 10_000, vapidDetails: vapid,
  })
  // Connect to the validated IP with the provider's TLS name and Host header. No second lookup, proxy or redirect.
  return await new Promise<number>((resolve, reject) => {
    const outgoing = request({
      hostname: address, port: 443, servername: endpoint.hostname,
      path: endpoint.pathname + endpoint.search, method: 'POST', agent: false,
      rejectUnauthorized: true, headers: { ...details.headers, Host: endpoint.hostname },
    }, (response) => {
      response.destroy()
      resolve(response.statusCode ?? 502)
    })
    const deadline = setTimeout(() => outgoing.destroy(new Error('Provider timeout')), 10000)
    outgoing.on('close', () => clearTimeout(deadline))
    outgoing.on('error', reject)
    outgoing.end(details.body)
  })
}
