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
export const scheduledPushStateSchema=z.object({
 publicKey:publicKeySchema,enrolled:z.boolean(),backgroundReady:z.boolean().default(false),
 preferences:notificationPreferences.extend({enabled:z.boolean(),timeZone:z.string()}).optional(),
 devices:z.array(z.object({id:z.uuid(),label:z.string()})),
})
export const pushConfigSchema = z.strictObject({ publicKey: publicKeySchema.nullable(), testEnabled: z.boolean(), enrollmentEnabled: z.boolean().optional(), enrolled: z.boolean().optional(),
  lastTest: z.enum(['serverAccepted', 'providerAccepted', 'providerRejected']).optional() })
export const pushMessageSchema = z.strictObject({ kind: z.enum(['test','reminder']), id: z.uuid(), language: notificationLanguage })
export type PushMessage = z.infer<typeof pushMessageSchema>
export const testRequestSchema = z.strictObject({
  endpointHash: z.string().regex(/^[0-9a-f]{64}$/), language: notificationLanguage,
})
