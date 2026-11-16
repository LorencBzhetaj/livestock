import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LivestockDatabase, schemaVersion } from '../src/db/database'
import { veterinaryEntrySchema, type VeterinaryEntry, type VeterinaryOperation } from '../src/db/healthModels'
import { createRepositories } from '../src/db/repositories'
import type { Animal } from '../src/db/models'
import { newId } from '../src/lib/identity'

const instant = '2026-10-01T08:30:00Z'
const date = '2026-10-01'
const times = { createdAt: instant, updatedAt: instant }
const vaccination = {
  kind: 'vaccination', date, productName: 'Test record', batchNumber: 'LOT-1',
  manufacturer: 'Test manufacturer', doseText: 'Recorded dose', route: 'Recorded route', vetName: 'Vet A',
  nextDueAt: '2026-12-01', notes: 'Recorded notes',
} as const
let db: LivestockDatabase
let repo: ReturnType<typeof createRepositories>
let animal: Animal

beforeEach(async () => {
  db = new LivestockDatabase(newId())
  repo = createRepositories(db)
  const speciesId = newId()
  await repo.species.save({ id: speciesId, code: 'goat', displayNameSq: 'Dhi', displayNameEn: 'Goat', active: true })
  animal = await repo.animals.save({ id: newId(), speciesId, earTag: 'HEALTH-1', sex: 'female', status: 'active', ...times })
})
afterEach(() => db.delete())

const operation = (entry: VeterinaryEntry, fields: Partial<VeterinaryOperation> = {}): VeterinaryOperation =>
  ({ operationId: newId(), animalIds: [animal.id], batch: false, entry, ...fields })

test('saves vaccine details once with linked animal IDs and exact owner-entered dates', async () => {
  const input = operation(vaccination)
  const first = await repo.health.submit(input)
  expect(await repo.health.submit(input)).toEqual(first)
  const [{ eventId, animalId }] = first.results
  expect(animalId).toBe(animal.id)
  expect(await repo.health.get(eventId)).toMatchObject({
    event: { animalId, kind: 'vaccination', occurredAt: '2026-10-01T00:00:00.000Z', dateOnly: true, vetName: 'Vet A' },
    vaccination: { healthEventId: eventId, animalId, productName: 'Test record', batchNumber: 'LOT-1',
      manufacturer: 'Test manufacturer', doseText: 'Recorded dose', route: 'Recorded route',
      nextDueAt: '2026-12-01T00:00:00.000Z', notes: 'Recorded notes' },
  })
  await expect(repo.health.submit({ ...input, entry: { ...vaccination, productName: 'Different' } })).rejects.toMatchObject({ code: 'operation' })
  expect(await db.vaccinations.count()).toBe(1)
  const second = await repo.health.submit(operation({ ...vaccination, nextDueAt: undefined }))
  expect((await repo.health.get(second.results[0].eventId))?.vaccination?.nextDueAt).toBeUndefined()
})

test('records visits, illness, observations and treatments, with explicit withdrawal dates only', async () => {
  const exam = { kind: 'checkup', date, reason: 'Exam', symptoms: 'Recorded symptom', findings: 'Finding',
    diagnosis: 'Recorded diagnosis', followUpDate: '2026-10-08', vetName: 'Vet A' } as const
  const treatment = { kind: 'treatment', date, reason: 'Recorded reason', medicineName: 'Product',
    doseText: 'Recorded amount', doseUnit: 'Recorded unit', route: 'Recorded route', duration: '5 days',
    endedAt: '2026-10-05', meatWithdrawalUntil: '2026-10-09', notes: 'Recorded note' } as const
  const entries: VeterinaryEntry[] = [
    exam, { ...exam, kind: 'illness' }, { ...exam, kind: 'followUp' },
    { kind: 'other', date, notes: 'Observation' }, treatment,
  ]
  const results = await Promise.all(entries.map((entry) => repo.health.submit(operation(entry))))
  expect(await repo.health.list(animal.id)).toHaveLength(5)
  expect((await repo.health.get(results[0].results[0].eventId))?.event).toMatchObject({
    reason: exam.reason, symptoms: exam.symptoms, findings: exam.findings, diagnosis: exam.diagnosis, followUpAt: '2026-10-08T00:00:00.000Z',
  })
  const detail = (await repo.health.get(results[4].results[0].eventId))?.treatment
  expect(detail).toMatchObject({ duration: '5 days', doseUnit: 'Recorded unit', meatWithdrawalUntil: '2026-10-09T00:00:00.000Z' })
  expect(detail?.milkWithdrawalUntil).toBeUndefined()
  expect(veterinaryEntrySchema.safeParse({ ...treatment, milkWithdrawalUntil: '2026-10-03' }).success).toBe(false)
  expect(veterinaryEntrySchema.safeParse({ ...vaccination, nextDueAt: '2026-09-30' }).success).toBe(false)
  expect(veterinaryEntrySchema.safeParse({ ...exam, followUpDate: '2026-09-30' }).success).toBe(false)
  expect(veterinaryEntrySchema.safeParse({ ...treatment, doseUnit: ' ' }).success).toBe(false)
})

test('retains archived history and permits an auditable, non-branching amendment chain', async () => {
  const saved = await repo.health.submit(operation(vaccination))
  const eventId = saved.results[0].eventId
  const original = await repo.health.get(eventId)
  await repo.animals.archive(animal.id)
  const amendment = { eventId, reason: 'Correct transcription' }
  const corrected = await repo.health.submit(operation({ ...vaccination, batchNumber: 'LOT-2' }, { amendment }))
  const newEventId = corrected.results[0].eventId
  expect(await repo.health.get(eventId)).toEqual(original)
  expect(await repo.health.amendmentOf(eventId)).toMatchObject({ id: newEventId, amendsId: eventId, amendmentReason: amendment.reason })
  expect((await repo.health.get(newEventId))?.vaccination?.batchNumber).toBe('LOT-2')
  await expect(repo.health.submit(operation(vaccination, { amendment }))).rejects.toMatchObject({ code: 'amendment' })
  await expect(repo.health.submit(operation({ kind: 'other', date, notes: 'Changed kind' }, {
    amendment: { ...amendment, eventId: newEventId },
  }))).rejects.toMatchObject({ code: 'amendment' })
  expect(await repo.health.list(animal.id)).toHaveLength(2)
})

test('vaccinates 150 animals atomically and returns the same linked IDs on concurrent and reopened retry', async () => {
  const herd = Array.from({ length: 149 }, (_, index) => ({ ...animal, id: newId(), earTag: 'BATCH-' + index }))
  await repo.animals.import(herd)
  const animalIds = [animal.id, ...herd.map(({ id }) => id)]
  const input = operation(vaccination, { batch: true, animalIds })
  const peer = new LivestockDatabase(db.name)
  try {
    const results = await Promise.all([
      repo.health.submit(input),
      createRepositories(peer).health.submit({ ...input, animalIds: [...animalIds].reverse() }),
    ])
    expect(results[1]).toEqual(results[0])
    expect(results[0].results).toHaveLength(150)
    expect(await db.healthEvents.where('batchId').equals(input.operationId).count()).toBe(150)
    expect(await db.vaccinations.count()).toBe(150)
    for (const { animalId, eventId } of results[0].results) {
      const detail = await db.vaccinations.get({ healthEventId: eventId })
      expect(detail?.animalId).toBe(animalId)
    }
    db.close()
    db = new LivestockDatabase(db.name)
    repo = createRepositories(db)
    expect(await repo.health.submit(input)).toEqual(results[0])
    await expect(repo.health.submit({ ...input, animalIds: animalIds.slice(1) })).rejects.toMatchObject({ code: 'operation' })
  } finally {
    peer.close()
  }
})

test('rolls back after a detail write fails and can retry the same operation', async () => {
  const second = await repo.animals.save({ ...animal, id: newId(), earTag: 'HEALTH-2' })
  const request = operation(vaccination, { batch: true, animalIds: [animal.id, second.id] })
  const failDetail = () => { throw new Error('Simulated detail write failure') }
  db.vaccinations.hook('creating', failDetail)
  await expect(repo.health.submit(request)).rejects.toThrow('Simulated detail write failure')
  expect(await db.healthEvents.count()).toBe(0)
  expect(await db.vaccinations.count()).toBe(0)
  expect(await db.veterinaryOperations.count()).toBe(0)
  db.vaccinations.hook('creating').unsubscribe(failDetail)
  await repo.animals.archive(second.id)
  await expect(repo.health.submit(request)).rejects.toMatchObject({ code: 'animals' })
  expect(await db.healthEvents.count()).toBe(0)
  await repo.animals.save(second)
  expect((await repo.health.submit(request)).results).toHaveLength(2)
})

test('upgrades a v2 database without changing its records, photographs, settings or legacy clinical details', async () => {
  const legacy = new Dexie(newId())
  legacy.version(2).stores({
    species: 'id, code', animals: 'id, earTag, speciesId, status, groupId, [status+earTag]',
    groups: 'id, name', healthEvents: 'id, animalId, occurredAt, [animalId+occurredAt], batchId',
    vaccinations: 'id, &healthEventId, animalId, administeredAt, nextDueAt', treatments: 'id, &healthEventId, animalId, startedAt',
    tasks: 'id, animalId, dueAt, status, [status+dueAt]', settings: 'key',
    auditEvents: 'id, [entityType+entityId], occurredAt', animalPhotos: 'animalId',
  })
  const event = { id: newId(), animalId: animal.id, kind: 'vaccination', occurredAt: instant, ...times }
  const detail = { id: newId(), healthEventId: event.id, animalId: animal.id, productName: 'Legacy', administeredAt: instant }
  await legacy.table('animals').add(animal)
  await legacy.table('animalPhotos').add({ animalId: animal.id, image: new Blob(['photo'], { type: 'image/png' }) })
  await legacy.table('healthEvents').add(event)
  await legacy.table('vaccinations').add(detail)
  await legacy.table('settings').add({ key: 'language', value: 'en', updatedAt: instant })
  legacy.close()
  const upgraded = new LivestockDatabase(legacy.name)
  try {
    const migrated = createRepositories(upgraded)
    expect(await migrated.animals.get(animal.id)).toEqual(animal)
    expect(upgraded.verno).toBe(schemaVersion)
    expect(await (await migrated.animals.getPhoto(animal.id))?.text()).toBe('photo')
    expect(await migrated.health.get(event.id)).toEqual({ event, vaccination: detail, treatment: undefined })
    expect(await migrated.settings.get('language')).toMatchObject({ value: 'en' })
    expect(await upgraded.veterinaryOperations.count()).toBe(0)
  } finally {
    await upgraded.delete()
  }
})
