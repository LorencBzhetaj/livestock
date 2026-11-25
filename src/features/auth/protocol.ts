import { z } from 'zod'
export const roles = z.enum(['ADMIN', 'VETERINARIAN'])
export type Role = z.infer<typeof roles>
export const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,40}$/)
// New Admin and Vet passwords. Login keeps accepting any stored password (1-128).
export const passwordMinimum = 8
export const password = z.string().min(passwordMinimum).max(128)
export const authSession = z.strictObject({
 farmId: z.uuid(), identityId: z.uuid(), deviceId: z.uuid(), name: z.string(),
 accountId: z.uuid(), username, role: roles, expiresAt: z.iso.datetime(),
})
export type AuthSession = z.infer<typeof authSession>
export const authRequest = z.discriminatedUnion('action', [
 z.strictObject({action:z.literal('login'),username,password:z.string().min(1).max(128),remember:z.boolean(),label:z.string().trim().min(1).max(80)}),
 z.strictObject({action:z.literal('setup'),username,password,code:z.string().regex(/^[A-Za-z0-9_-]{43}$/),remember:z.boolean(),label:z.string().trim().min(1).max(80)}),
 z.strictObject({action:z.literal('status')}),
 z.strictObject({action:z.literal('session')}),
 z.strictObject({action:z.literal('logout')}),
 z.strictObject({action:z.literal('vet'),username,password,currentPassword:z.string().min(1).max(128)}),
])
