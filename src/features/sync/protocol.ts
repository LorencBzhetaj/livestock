import { z } from 'zod'
import { animalSchema, groupSchema, healthEventSchema, speciesSchema, treatmentSchema, vaccinationSchema } from '../../db/models.js'
import { veterinaryReceiptSchema } from '../../db/healthModels.js'
import { taskSchema } from '../../db/taskModels.js'

export const entitySchemas = {
  species: speciesSchema, groups: groupSchema, animals: animalSchema, healthEvents: healthEventSchema,
  vaccinations: vaccinationSchema, treatments: treatmentSchema, veterinaryOperations: veterinaryReceiptSchema, tasks: taskSchema,
}
export const entities = Object.keys(entitySchemas) as (keyof typeof entitySchemas)[]
export const entitySchema = z.enum(entities)
export type Entity = z.infer<typeof entitySchema>
export const appendOnly = new Set<Entity>(['healthEvents', 'vaccinations', 'treatments', 'veterinaryOperations'])
const id = z.uuid()
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const cursor = z.string().regex(/^(0|[1-9]\d{0,17})$/)
const target = { entity: entitySchema, recordId: id }
export const mutationSchema = z.strictObject({
  ...target, base: version, type: z.enum(['create', 'update', 'archive', 'delete']), payload: z.json().nullable(),
}).superRefine((item, ctx) => {
  const parsed = entitySchemas[item.entity].safeParse(item.payload)
  const valid = item.type === 'delete'
    ? item.entity === 'tasks' && item.payload === null && item.base > 0
    : parsed.success && parsed.data.id === item.recordId
      && (item.type === 'create' ? item.base === 0 : item.base > 0 && !appendOnly.has(item.entity))
      && (item.type !== 'archive' || item.entity === 'animals' && 'status' in parsed.data && parsed.data.status === 'archived')
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid synchronization mutation' })
})
export const operationSchema = z.strictObject({
  id, farmId: id, deviceId: id, createdAt: z.iso.datetime(), initial: z.boolean(),
  mutations: z.array(mutationSchema).min(1).max(4000),
}).refine(({ mutations }) => mutations.length === new Set(mutations.map(keyOf)).size)
export const changeSchema = z.strictObject({ ...target, cursor, version: version.min(1), payload: z.json().nullable() })
  .refine(({ entity, recordId, payload }) => {
    if (payload === null) return entity === 'tasks'
    const parsed = entitySchemas[entity].safeParse(payload)
    return parsed.success && parsed.data.id === recordId
  })
export const resultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('applied'), versions: z.array(z.strictObject({ ...target, version: version.min(1) })) }),
  z.strictObject({
    status: z.literal('conflict'), reason: z.enum(['stale', 'constraint', 'initial']),
    current: z.array(changeSchema),
  }),
])
export const pageSchema = z.strictObject({ changes: z.array(changeSchema).max(100), cursor, more: z.boolean() })
export const sessionSchema = z.strictObject({ farmId: id, identityId: id, deviceId: id, name: z.string().min(1).max(80),
  role: z.enum(['ADMIN','VETERINARIAN']).optional(), accountId: id.optional(), username: z.string().optional(), expiresAt: z.iso.datetime().optional(),
})
export const devicesSchema = z.array(z.strictObject({ id, label: z.string(), revoked: z.boolean(), createdAt: z.iso.datetime() }))
const code = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const label = z.string().trim().min(1).max(80)
export const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('enroll'), code, label }),
  z.strictObject({ action: z.literal('session') }),
  z.strictObject({ action: z.literal('devices') }),
  z.strictObject({ action: z.literal('invite') }),
  z.strictObject({ action: z.literal('revoke'), deviceId: id }),
  z.strictObject({ action: z.literal('push'), operation: operationSchema }),
  z.strictObject({ action: z.literal('pull'), cursor, limit: z.number().int().min(1).max(100) }),
])
export type SyncRequest = z.infer<typeof requestSchema>
export type Mutation = z.infer<typeof mutationSchema>
export type Operation = z.infer<typeof operationSchema>
export type Change = z.infer<typeof changeSchema>
export type Result = z.infer<typeof resultSchema>
export type Session = z.infer<typeof sessionSchema>
export type Page = z.infer<typeof pageSchema>

export function keyOf(item: { entity: Entity; recordId: string }) {
  return item.entity + ':' + item.recordId
}

export function payloadFor(entity: Entity, record: unknown): NonNullable<Mutation['payload']> {
  return z.json().parse(JSON.parse(JSON.stringify(entitySchemas[entity].parse(record))))!
}
