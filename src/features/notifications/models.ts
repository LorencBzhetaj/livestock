import { z } from 'zod'

export const notificationLanguage = z.enum(['sq', 'en'])
export const preferenceKey = 'notificationPreferences'
export const notificationPreferences = z.strictObject({
  language: notificationLanguage,
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  leadDays: z.number().int().min(0).max(30),
})
export type NotificationPreferences = z.infer<typeof notificationPreferences>

export const publicKeySchema = z.string().regex(/^B[A-Za-z0-9_-]{86}$/)
export const pushConfigSchema = z.strictObject({ publicKey: publicKeySchema.nullable(), testEnabled: z.boolean() })
export const pushMessageSchema = z.strictObject({ kind: z.literal('test'), id: z.uuid(), language: notificationLanguage })
export type PushMessage = z.infer<typeof pushMessageSchema>
export const testRequestSchema = z.strictObject({
  endpointHash: z.string().regex(/^[0-9a-f]{64}$/), language: notificationLanguage,
})
