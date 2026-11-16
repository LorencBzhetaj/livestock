import 'fake-indexeddb/auto'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LivestockDatabase } from '../src/db/database'
import type { VeterinaryOperation } from '../src/db/healthModels'
import { createRepositories } from '../src/db/repositories'
import { createBackup, previewBackup, restoreBackup } from '../src/features/backup/backup'
import { collections, countRecords, maxBackupBytes, type BackupData } from '../src/features/backup/format'
import { newId } from '../src/lib/identity'
import { sha256 } from '../src/lib/sha256'

const timestamp = '2026-03-17T10:00:00.000Z'
const date = '2026-03-17'
const nextDate = '2026-04-17'
let source: LivestockDatabase
let target: LivestockDatabase

beforeEach(() => {
  source = new LivestockDatabase(newId())
  target = new LivestockDatabase(newId())
})
afterEach(async () => {
  await source.delete()
  await target.delete()
})

function file(data: BlobPart, name = 'test.backup.json', type = 'application/json') {
  return new File([data], name, { type })
}

async function readBackup(db: LivestockDatabase) {
  return JSON.parse(await (await createBackup(db)).file.text()) as {
    data: BackupData
    format: string
    formatVersion: number
    schemaVersion: number
    exportedAt: string
    counts: ReturnType<typeof countRecords>
    checksum: string
  }
}

async function reseal(backup: Awaited<ReturnType<typeof readBackup>>) {
  const { format, formatVersion, schemaVersion, exportedAt, data } = backup
  const body = { format, formatVersion, schemaVersion, exportedAt, counts: countRecords(data), data }
  const checksum = await sha256(new TextEncoder().encode(JSON.stringify(body)))
  return file(JSON.stringify({ ...body, checksum }))
}

async function seed(db: LivestockDatabase, count = 2) {
  const repo = createRepositories(db)
  await repo.species.ensureCatalog()
  const goat = (await repo.species.list()).find(({ code }) => code === 'goat')!
  const group = { id: newId(), name: 'Synthetic cohort', createdAt: timestamp, updatedAt: timestamp }
  await repo.groups.save(group)
  const animals = Array.from({ length: count }, (_, index) => ({
    id: newId(), groupId: group.id, speciesId: goat.id, earTag: 'BACKUP-' + index, sex: 'female' as const,
    status: 'active' as const, createdAt: timestamp, updatedAt: timestamp,
  }))
  await repo.animals.import(animals)
  const image = new Blob([await readFile('public/icon-192.png')], { type: 'image/png' })
  await repo.animals.save(animals[0], image)
  const operation: VeterinaryOperation = {
    operationId: newId(), batch: true, animalIds: animals.map(({ id }) => id),
    entry: { kind: 'vaccination', date, productName: 'Synthetic product', nextDueAt: nextDate, notes: 'Synthetic notes' },
  }
  const receipt = await repo.health.submit(operation)
  const eventId = receipt.results[0].eventId
  await repo.health.submit({
    operationId: newId(), batch: false, animalIds: [animals[0].id],
    entry: { ...operation.entry, notes: 'Corrected synthetic notes' },
    amendment: { eventId, reason: 'Synthetic correction' },
  })
  await repo.health.submit({
    operationId: newId(), batch: false, animalIds: [animals[0].id],
    entry: { kind: 'treatment', date, reason: 'Synthetic reason', medicineName: 'Synthetic medicine',
      doseText: 'Fixture amount', doseUnit: 'Fixture unit', route: 'Fixture route', duration: 'Fixture duration',
      followUpDate: nextDate },
  })
  const reminder = await repo.tasks.fromEvent({ eventId, dueDate: nextDate, title: 'Synthetic reminder' })
  await repo.tasks.finish(reminder.task.id, 'completed')
  const task = await repo.tasks.create({ title: 'Synthetic task', type: 'general', dueDate: date })
  await repo.tasks.finish(task.id, 'cancelled')
  await repo.animals.archive(animals[0].id)
  await repo.settings.save({ key: 'language', value: 'en', updatedAt: timestamp })
  await repo.settings.save({ key: 'demoSeeded', value: false, updatedAt: timestamp })
  await repo.audit.append({ id: newId(), entityType: 'animal', entityId: animals[0].id, action: 'archive',
    occurredAt: timestamp, summary: 'Synthetic audit entry' })
  return { operation, receipt, animal: animals[0], image, eventId }
}

test('exports 200 animals and restores every store, photo, amendment, receipt and task semantically', async () => {
  const { animal, operation, receipt, image, eventId } = await seed(source, 200)
  const exported = await createBackup(source)
  const original = await readBackup(source)
  await createRepositories(target).settings.save({ key: 'language', value: 'sq', updatedAt: timestamp })
  const preview = await previewBackup(file(exported.file))
  expect(preview).toMatchObject({ archived: 1, counts: {
    animals: 200, healthEvents: 202, vaccinations: 201, treatments: 1, animalPhotos: 1, tasks: 2,
    veterinaryOperations: 3, settings: 2, auditEvents: 1,
  } })
  expect(await createRepositories(target).settings.get('language')).toMatchObject({ value: 'sq' })
  await restoreBackup(target, preview)
  await restoreBackup(target, preview)
  const restored = await readBackup(target)
  expect(restored.data).toEqual(original.data)
  expect(restored.counts).toEqual(original.counts)
  expect(Object.keys(restored.data)).toEqual([...collections])
  const repo = createRepositories(target)
  expect(await repo.animals.get(animal.id)).toMatchObject({ status: 'archived' })
  expect(await (await repo.animals.getPhoto(animal.id))?.arrayBuffer()).toEqual(await image.arrayBuffer())
  expect(await repo.health.submit(operation)).toEqual(receipt)
  expect((await repo.health.latest(eventId))?.event.notes).toBe('Corrected synthetic notes')
})

test('rejects malformed, oversized, unsupported and corrupted files before changing data', async () => {
  const backup = await readBackup(source)
  await expect(previewBackup(file('{broken'))).rejects.toMatchObject({ code: 'malformed' })
  await expect(previewBackup(file('{}', 'bad.txt', 'text/html'))).rejects.toMatchObject({ code: 'file' })
  const big = { name: 'big.json', type: 'application/json', size: maxBackupBytes + 1 } as File
  await expect(previewBackup(big)).rejects.toMatchObject({ code: 'size' })
  await expect(previewBackup(file(JSON.stringify({ ...backup, formatVersion: 999 })))).rejects.toMatchObject({ code: 'version' })
  await expect(previewBackup(file(JSON.stringify({ ...backup, schemaVersion: 999 })))).rejects.toMatchObject({ code: 'version' })
  await expect(previewBackup(file(JSON.stringify({ ...backup, exportedAt: timestamp })))).rejects.toMatchObject({ code: 'checksum' })
  expect(await source.animals.count()).toBe(0)
})

test('rejects resealed backups with duplicate keys or active tags, invalid relationships, receipts and photos', async () => {
  await seed(source)
  const original = await readBackup(source)
  async function reject(change: (data: BackupData) => void, code: string) {
    const backup = structuredClone(original)
    change(backup.data)
    await expect(previewBackup(await reseal(backup))).rejects.toMatchObject({ code })
  }
  await reject((data) => data.animals.push(data.animals[0]), 'duplicates')
  await reject((data) => {
    data.animals[0].status = 'active'
    data.animals[1].status = 'active'
    data.animals[0].earTag = ' ' + data.animals[1].earTag.toLowerCase()
  }, 'duplicates')
  await reject((data) => { data.animals[0].speciesId = newId() }, 'relationships')
  await reject((data) => { data.animals[0].damId = data.animals[1].id; data.animals[1].sireId = data.animals[0].id }, 'relationships')
  await reject((data) => { data.healthEvents.find((row) => row.amendsId)!.amendsId = newId() }, 'relationships')
  await reject((data) => { data.vaccinations[0].animalId = newId() }, 'relationships')
  await reject((data) => { data.veterinaryOperations[0].results[0].eventId = newId() }, 'relationships')
  await reject((data) => { data.veterinaryOperations[0].fingerprint = '1'.repeat(64) }, 'relationships')
  await reject((data) => { data.tasks.find((task) => task.healthEventId)!.healthEventId = newId() }, 'relationships')
  await reject((data) => { data.animalPhotos[0].mimeType = 'image/jpeg' }, 'photos')
  await reject((data) => { data.animalPhotos[0].size += 1 }, 'photos')
  await reject((data) => { data.settings.push({ key: 'unknown', value: 'test', updatedAt: timestamp }) }, 'records')
})

test('rolls back a late write failure for every store and peer readers and can retry safely', async () => {
  await seed(source)
  await seed(target)
  const old = await readBackup(target)
  const peer = new LivestockDatabase(target.name)
  const preview = await previewBackup(file((await createBackup(source)).file))
  const fail = () => { throw new Error('Synthetic write failure') }
  target.auditEvents.hook('creating', fail)
  try {
    await expect(restoreBackup(target, preview)).rejects.toThrow('Synthetic write failure')
    expect((await readBackup(peer)).data).toEqual(old.data)
    expect((await readBackup(target)).data).toEqual(old.data)
    target.auditEvents.hook('creating').unsubscribe(fail)
    await restoreBackup(target, preview)
    expect((await readBackup(peer)).data).toEqual((await readBackup(source)).data)
  } finally {
    peer.close()
  }
})

test('an explicitly aborted transaction preserves all original data', async () => {
  await seed(source)
  await seed(target)
  const old = await readBackup(target)
  const preview = await previewBackup(file((await createBackup(source)).file))
  const abort = (_id: string, _row: unknown, transaction: { abort(): void }) => transaction.abort()
  target.tasks.hook('creating', abort)
  await expect(restoreBackup(target, preview)).rejects.toThrow()
  expect((await readBackup(target)).data).toEqual(old.data)
})
