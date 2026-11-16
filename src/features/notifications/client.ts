import { sha256 } from '../../lib/sha256'
import { pushConfigSchema, type NotificationPreferences } from './models'

export const pushEndpoint = import.meta.env.BASE_URL + 'api/push'

export function capabilities(input: {
  secure: boolean; standalone: boolean; notification: boolean; push: boolean; registration: boolean;
}) {
  return { ...input, supported: input.secure && input.notification && input.push && input.registration }
}

export function requestNotificationPermission(api: Pick<typeof Notification, 'permission' | 'requestPermission'>) {
  return api.permission === 'default' ? api.requestPermission() : Promise.resolve(api.permission)
}

export function subscribeDevice(manager: Pick<PushManager, 'subscribe'>, key: string) {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/') + '='
  return manager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)) })
}

async function pushFetch(options: RequestInit = {}, timeout = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try { return await fetch(pushEndpoint, { ...options, cache: 'no-store', redirect: 'error', signal: controller.signal }) }
  finally { clearTimeout(timer) }
}

export async function loadPushConfig() {
  const response = await pushFetch()
  if (!response.ok) throw new Error('Unavailable')
  return pushConfigSchema.parse(await response.json())
}

export async function sendTest(subscription: PushSubscription, token: string, language: NotificationPreferences['language']) {
  const endpointHash = await sha256(new TextEncoder().encode(subscription.endpoint))
  const response = await pushFetch({
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ endpointHash, language }),
  }, 15_000)
  if (response.status === 410) return 'expired'
  if (response.status === 429) return 'limited'
  if (response.status === 202 && (await response.json()).status === 'accepted') return 'accepted'
  return 'failure'
}
