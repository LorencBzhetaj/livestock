import { createCipheriv, createDecipheriv, createHash, createHmac, ECDH, randomBytes, timingSafeEqual } from 'node:crypto'
import { BlockList } from 'node:net'
import { z } from 'zod'
import { publicKeySchema } from '../src/features/notifications/models.js'

export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const cookieName = '__Host-livestock-push'
const uuid = z.uuid()

export function supportedProvider(value: string) {
  try {
    const url = new URL(value)
    return url.href === value && url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !url.hash && (
        (url.hostname === 'fcm.googleapis.com' && url.pathname.startsWith('/fcm/send/')) ||
        (url.hostname === 'updates.push.services.mozilla.com' && url.pathname.startsWith('/wpush/')) ||
        (url.hostname === 'web.push.apple.com' && url.pathname.length > 1)
      )
  } catch { return false }
}

export const enrolledSubscription = z.strictObject({
  endpoint: z.string().max(2048).refine(supportedProvider),
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.strictObject({
    p256dh: publicKeySchema.refine((key) => {
      try {
        const bytes = Buffer.from(key, 'base64url')
        return bytes.toString('base64url') === key && ECDH.convertKey(bytes, 'prime256v1').length === 65
      } catch { return false }
    }),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/).refine((key) => Buffer.from(key, 'base64url').toString('base64url') === key),
  }),
})
export type EnrolledSubscription = z.infer<typeof enrolledSubscription>

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(address, prefix, 'ipv4')

export function selectPublicAddress(addresses: string[]) {
  if (!addresses.length || addresses.some((address) => !z.ipv4().safeParse(address).success || blocked.check(address))) {
    throw new Error('Unsafe provider address')
  }
  return addresses[0]
}

export function pushSecrets(key: Buffer) {
  const encryptionKey = createHmac('sha256', key).update('push-subscription-v1').digest()
  const sign = (id: string) => createHmac('sha256', key).update('push-device-v1:' + id).digest('base64url')
  return {
    cookie(id?: string) {
      return cookieName + '=' + (id ? id + '.' + sign(id) : '') +
        '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (id ? 30 * 86400 : 0)
    },
    authenticate(header?: string) {
      const raw = header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(cookieName + '='))
      const parts = raw?.slice(cookieName.length + 1).split('.')
      if (!parts || parts.length !== 2 || !uuid.safeParse(parts[0]).success || !tokenSchema.safeParse(parts[1]).success) return
      return timingSafeEqual(Buffer.from(sign(parts[0])), Buffer.from(parts[1])) ? parts[0] : undefined
    },
    seal(id: string, subscription: EnrolledSubscription) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv).setAAD(Buffer.from(id))
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(subscription), 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
    },
    open(id: string, value: string) {
      const bytes = Buffer.from(value, 'base64url')
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12))
        .setAAD(Buffer.from(id)).setAuthTag(bytes.subarray(12, 28))
      return enrolledSubscription.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')))
    },
  }
}
