import { z } from 'zod'
import { schemaVersion } from '../../db/database'
import {
  animalSchema, auditEventSchema, groupSchema, healthEventSchema, maxPhotoBytes, photoTypes,
  settingSchema, speciesSchema, treatmentSchema, vaccinationSchema,
} from '../../db/models'
import { veterinaryReceiptSchema } from '../../db/healthModels'
import { taskSchema } from '../../db/taskModels'

export const backupFormat = 'livestockos-backup'
export const backupVersion = 1
export const maxBackupBytes = 128 * 1024 * 1024

export const collections = [
  'species', 'groups', 'animals', 'animalPhotos', 'healthEvents', 'vaccinations',
  'treatments', 'veterinaryOperations', 'tasks', 'settings', 'auditEvents',
] as const
export type Collection = typeof collections[number]

export const dataSchema = z.strictObject({
  species: z.array(speciesSchema),
  groups: z.array(groupSchema),
  animals: z.array(animalSchema),
  animalPhotos: z.array(z.strictObject({
    animalId: z.uuid(), mimeType: z.enum(photoTypes),
    size: z.number().int().positive().max(maxPhotoBytes), base64: z.string(),
  })),
  healthEvents: z.array(healthEventSchema),
  vaccinations: z.array(vaccinationSchema),
  treatments: z.array(treatmentSchema),
  veterinaryOperations: z.array(veterinaryReceiptSchema),
  tasks: z.array(taskSchema),
  settings: z.array(settingSchema.refine(({ key, value }) =>
    key === 'language' || (key === 'demoSeeded' && typeof value === 'boolean'),
  )),
  auditEvents: z.array(auditEventSchema),
})
export type BackupData = z.infer<typeof dataSchema>

export const headerSchema = z.strictObject({
  format: z.literal(backupFormat), formatVersion: z.number().int(), schemaVersion: z.number().int(),
  exportedAt: z.iso.datetime(),
  counts: z.record(z.enum(collections), z.number().int().nonnegative()),
  data: z.unknown(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
})

export const versionFields = { format: backupFormat, formatVersion: backupVersion, schemaVersion } as const

export class BackupError extends Error {
  constructor(readonly code: 'file' | 'size' | 'malformed' | 'version' | 'checksum' | 'records' | 'duplicates' | 'relationships' | 'photos') {
    super(code)
  }
}

export function countRecords(data: BackupData) {
  return Object.fromEntries(collections.map((key) => [key, data[key].length])) as Record<Collection, number>
}
