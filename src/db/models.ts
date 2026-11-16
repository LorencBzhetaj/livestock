import { z } from 'zod'
import { normalizeEarTag } from './animalTags'
import { notificationPreferences, preferenceKey } from '../features/notifications/models'

const id = z.uuid()
const timestamp = z.iso.datetime()
const date = z.iso.date()
const text = z.string().trim().min(1)
const notes = z.string().trim().optional()
const created = { createdAt: timestamp, updatedAt: timestamp }

export const animalSexes = ['female', 'male', 'unknown'] as const
export const photoTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export const maxPhotoBytes = 5 * 1024 * 1024
export const animalPhotoSchema = z.strictObject({
  animalId: id,
  image: z.instanceof(Blob).refine(
    (blob) => blob.size > 0 && blob.size <= maxPhotoBytes && photoTypes.some((type) => type === blob.type),
    'Invalid photograph',
  ),
})

export const animalStatuses = ['active', 'sold', 'deceased', 'archived'] as const
export const languages = ['sq', 'en'] as const
export const speciesSchema = z.strictObject({
  id, code: z.enum(['goat', 'sheep', 'cattle', 'other']),
  displayNameSq: text, displayNameEn: text, active: z.boolean(),
})
export const animalSchema = z.strictObject({
  id, earTag: text.transform(normalizeEarTag), name: notes,
  speciesId: id, breed: notes, sex: z.enum(animalSexes),
  birthDate: date.optional(), birthDateApproximate: z.boolean().optional(),
  acquisitionDate: date.optional(), source: notes, damId: id.optional(),
  sireId: id.optional(), groupId: id.optional(), status: z.enum(animalStatuses),
  notes, ...created,
}).refine(({ id, damId, sireId }) => id !== damId && id !== sireId, 'An animal cannot be its own parent')
  .refine(({ birthDate, acquisitionDate }) => !birthDate || !acquisitionDate || birthDate <= acquisitionDate,
    { path: ['acquisitionDate'], message: 'Acquisition must be on or after birth' })

export const groupSchema = z.strictObject({ id, name: text, location: notes, notes, ...created })
export const healthKinds = ['checkup', 'vaccination', 'treatment', 'illness', 'followUp', 'other'] as const
export const healthEventSchema = z.strictObject({
  id, animalId: id, kind: z.enum(healthKinds),
  occurredAt: timestamp, dateOnly: z.boolean().optional(), vetName: notes, notes, batchId: id.optional(),
  reason: notes, symptoms: notes, findings: notes, diagnosis: notes, followUpAt: timestamp.optional(),
  amendsId: id.optional(), amendmentReason: text.optional(), ...created,
})
export const vaccinationSchema = z.strictObject({
  id, healthEventId: id, animalId: id, productName: text, batchNumber: notes,
  administeredAt: timestamp, nextDueAt: timestamp.optional(), vetName: notes, notes,
  manufacturer: notes, doseText: notes, route: notes,
}).refine(({ administeredAt, nextDueAt }) => !nextDueAt || Date.parse(nextDueAt) >= Date.parse(administeredAt),
  { path: ['nextDueAt'], message: 'Due date must be on or after administration' })
export const treatmentSchema = z.strictObject({
  id, healthEventId: id, animalId: id, medicineName: text, doseText: notes,
  startedAt: timestamp, endedAt: timestamp.optional(), meatWithdrawalUntil: timestamp.optional(),
  milkWithdrawalUntil: timestamp.optional(), vetName: notes, notes,
  reason: notes, doseUnit: notes, route: notes, duration: notes,
}).refine(({ startedAt, endedAt }) => !endedAt || Date.parse(endedAt) >= Date.parse(startedAt),
  { path: ['endedAt'], message: 'End must be on or after start' })

export const settingSchema = z.strictObject({ key: text, value: z.json(), updatedAt: timestamp })
  .refine(({ key, value }) => key !== 'language' || z.enum(languages).safeParse(value).success,
    { path: ['value'], message: 'Unsupported language' })
  .refine(({ key, value }) => key !== preferenceKey || notificationPreferences.safeParse(value).success,
    { path: ['value'], message: 'Invalid notification preferences' })
export const auditEventSchema = z.strictObject({
  id, entityType: text, entityId: id, action: text, occurredAt: timestamp, summary: text,
})

export type Species = z.infer<typeof speciesSchema>
export type AnimalPhoto = z.infer<typeof animalPhotoSchema>
export type Animal = z.infer<typeof animalSchema>
export type Group = z.infer<typeof groupSchema>
export type HealthEvent = z.infer<typeof healthEventSchema>
export type Vaccination = z.infer<typeof vaccinationSchema>
export type Treatment = z.infer<typeof treatmentSchema>
export type Setting = z.infer<typeof settingSchema>
export type AuditEvent = z.infer<typeof auditEventSchema>
export type Language = typeof languages[number]
