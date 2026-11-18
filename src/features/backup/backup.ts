import { type LivestockDatabase } from '../../db/database'
import type { AnimalPhoto } from '../../db/models'
import { now } from '../../lib/identity'
import { sha256 } from '../../lib/sha256'
import {
  backupVersion, backupSchemaVersion, BackupError, collections, countRecords, dataSchema, headerSchema, maxBackupBytes, versionFields,
  type BackupData, type Collection,
} from './format'
import { encodePhoto, decodePhoto } from './photos'
import { validateRelationships } from './relationships'
import { validateReceiptFingerprints } from './receipts'

export type RestorePreview = Readonly<{
  exportedAt: string
  counts: Readonly<Record<Collection, number>>
  archived: number
  size: number
}>

type RestoreData = Omit<BackupData, 'animalPhotos'> & { animalPhotos: AnimalPhoto[] }
const validated = new WeakMap<RestorePreview, RestoreData>()

function applicationTables(db: LivestockDatabase) {
  if (!collections.every((key) => db.tables.some(({ name }) => name === key))) {
    throw new BackupError('version')
  }
  return collections.map((key) => db.table(key))
}

async function validateRecords(raw: unknown) {
  const parsed = dataSchema.safeParse(raw)
  if (!parsed.success) throw new BackupError('records')
  validateRelationships(parsed.data)
  await validateReceiptFingerprints(parsed.data)
  return parsed.data
}

export async function createBackup(db: LivestockDatabase) {
  const tables = applicationTables(db)
  const snapshot = await db.transaction('r', tables, async () => {
    const rows = await Promise.all(tables.map(async (table) => [table.name, await table.toArray()]))
    return Object.fromEntries(rows)
  })
  const photos: AnimalPhoto[] = snapshot.animalPhotos
  if (photos.reduce((size, { image }) => size + 4 * Math.ceil(image.size / 3), 0) >= maxBackupBytes) {
    throw new BackupError('size')
  }
  const animalPhotos = []
  for (const photo of photos) animalPhotos.push(await encodePhoto(photo))
  const data = await validateRecords({ ...snapshot, animalPhotos })
  const exportedAt = now()
  const json = JSON.stringify({ ...versionFields, exportedAt, counts: countRecords(data), data })
  const bytes = new TextEncoder().encode(json)
  // Appending the checksum key and hex value adds 78 ASCII bytes.
  if (bytes.length + 78 > maxBackupBytes) throw new BackupError('size')
  const checksum = await sha256(bytes)
  const file = new Blob([bytes.subarray(0, -1), ',"checksum":"', checksum, '"}'], { type: 'application/json' })
  return { file, exportedAt, name: 'livestockos-' + exportedAt.replace(/[:.]/g, '-') + '.backup.json' }
}

export async function previewBackup(file: File): Promise<RestorePreview> {
  if (!/\.json$/i.test(file.name) || !['', 'application/json', 'application/octet-stream', 'text/plain'].includes(file.type)) {
    throw new BackupError('file')
  }
  if (file.size > maxBackupBytes) throw new BackupError('size')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let raw: unknown
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
    raw = JSON.parse(decoder.decode(bytes))
  } catch {
    throw new BackupError('malformed')
  }
  const header = headerSchema.safeParse(raw)
  if (!header.success) throw new BackupError('malformed')
  const { formatVersion, schemaVersion: sourceVersion, exportedAt, counts, data, checksum } = header.data
  if (formatVersion !== backupVersion || sourceVersion !== backupSchemaVersion) throw new BackupError('version')

  const suffix = ',"checksum":"' + checksum + '"}'
  const suffixStart = bytes.length - suffix.length
  let matches = false
  if (suffixStart >= 0 && bytes.subarray(suffixStart).every((byte, index) => byte === suffix.charCodeAt(index))) {
    // Exported files can be hashed from the input buffer without rebuilding the JSON.
    bytes[suffixStart] = 125
    matches = (await sha256(bytes.subarray(0, suffixStart + 1))) === checksum
  }
  if (!matches) {
    const body = { ...versionFields, exportedAt, counts: (raw as { counts: unknown }).counts, data }
    if (await sha256(new TextEncoder().encode(JSON.stringify(body))) !== checksum) throw new BackupError('checksum')
  }
  const records = await validateRecords(data)
  const actualCounts = countRecords(records)
  if (collections.some((key) => counts[key] !== actualCounts[key])) throw new BackupError('records')
  const animalPhotos = []
  for (const photo of records.animalPhotos) animalPhotos.push(await decodePhoto(photo))
  const preview = Object.freeze({
    exportedAt, counts: Object.freeze(actualCounts), archived: records.animals.filter(({ status }) => status === 'archived').length, size: file.size,
  })
  validated.set(preview, { ...records, animalPhotos })
  return preview
}

export async function restoreBackup(db: LivestockDatabase, preview: RestorePreview) {
  const records = validated.get(preview)
  if (!records) throw new BackupError('records')
  const tables = applicationTables(db)
  // Every store participates, so IndexedDB serializes peer-tab writes with the replacement.
  await db.transaction('rw', [...tables, db.syncState], async () => {
    if (await db.syncState.get('farm')) throw new BackupError('syncLinked')
    for (const key of collections) {
      const table = db.table(key)
      await table.clear()
      await table.bulkAdd(records[key])
    }
  })
}
