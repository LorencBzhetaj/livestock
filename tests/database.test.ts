import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LivestockDatabase, schemaVersion } from '../src/db/database'
import { createRepositories, seedDemo } from '../src/db/repositories'
import type { Animal, HealthEvent, Species, Treatment, Vaccination } from '../src/db/models'
import { newId } from '../src/lib/identity'

const timestamp = '2026-11-16T10:00:00Z'
const timestamps = { createdAt: timestamp, updatedAt: timestamp }
const sheep: Species = {
  id: newId(), code: 'sheep', displayNameSq: 'Dele', displayNameEn: 'Sheep', active: true,
}
const animalRecord = (earTag = 'AL-1'): Animal => ({
  id: newId(), earTag, speciesId: sheep.id, sex: 'female', status: 'active', ...timestamps,
})

let db: LivestockDatabase
let repo: ReturnType<typeof createRepositories>

beforeEach(() => {
  db = new LivestockDatabase(newId())
  repo = createRepositories(db)
})
afterEach(() => db.delete())

test('opens an empty current database and reopens it without mutation', async () => {
  await db.open()
  expect(db.verno).toBe(schemaVersion)
  expect(db.tables.map(({ name }) => name).sort()).toEqual([
    'animalPhotos', 'animals', 'auditEvents', 'groups', 'healthEvents', 'settings', 'species', 'tasks', 'treatments', 'vaccinations', 'veterinaryOperations',
  ])
  expect(await repo.animals.list()).toEqual([])
  expect(await repo.species.list()).toEqual([])
  await repo.species.save(sheep)
  const animal = await repo.animals.save(animalRecord(' al-1 '))
  await repo.settings.save({ key: 'language', value: 'en', updatedAt: timestamp })
  db.close()
  db = new LivestockDatabase(db.name)
  repo = createRepositories(db)
  expect(await repo.animals.get(animal.id)).toEqual({ ...animal, earTag: 'AL-1' })
  expect(await repo.settings.get('language')).toMatchObject({ value: 'en' })
  expect(db.verno).toBe(schemaVersion)
})

test('serializes active tag checks and releases a tag on archive', async () => {
  await repo.species.save(sheep)
  const anotherTab = new LivestockDatabase(db.name)
  try {
    const results = await Promise.allSettled([
      repo.animals.save(animalRecord(' al-1 ')),
      createRepositories(anotherTab).animals.save(animalRecord('AL-1')),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    const [first] = await repo.animals.list()
    await repo.animals.archive(first.id)
    const replacement = await repo.animals.save(animalRecord())
    await expect(repo.animals.save({ ...first, status: 'active' })).rejects.toThrow('ear tag')
    expect(await repo.animals.countActive()).toBe(1)
    expect(await repo.animals.get(replacement.id)).toEqual(replacement)
  } finally {
    anotherTab.close()
  }
})

test('validates animal records, references and parent cycles on save', async () => {
  const animal = animalRecord()
  await expect(repo.animals.save(animal)).rejects.toThrow('Species missing')
  await repo.species.save(sheep)
  await expect(repo.animals.save({ ...animal, earTag: ' ' })).rejects.toThrow()
  await expect(repo.animals.save({ ...animal, groupId: newId() })).rejects.toThrow('Group missing')
  await expect(repo.animals.save({ ...animal, damId: animal.id })).rejects.toThrow('own parent')
  await expect(repo.animals.save({ ...animal, damId: newId() })).rejects.toThrow('Parent missing')
  const group = { id: newId(), name: 'Group A', ...timestamps }
  await repo.groups.save(group)
  await repo.animals.save({ ...animal, groupId: group.id })
  const child = await repo.animals.save({ ...animalRecord('AL-2'), damId: animal.id })
  await expect(repo.animals.save({ ...animal, sireId: child.id })).rejects.toThrow('cycle')
  expect(await repo.groups.list()).toEqual([group])
  expect(await repo.animals.countActive()).toBe(2)
})

test('records vaccination and treatment atomically, preserving history on archive', async () => {
  await repo.species.save(sheep)
  const animal = await repo.animals.save(animalRecord())
  const event: HealthEvent = {
    id: newId(), animalId: animal.id, kind: 'vaccination', occurredAt: timestamp, ...timestamps,
  }
  const vaccination: Vaccination = {
    id: newId(), healthEventId: event.id, animalId: animal.id, productName: 'TEST', administeredAt: timestamp,
  }
  await expect(repo.health.record(event)).rejects.toThrow()
  await expect(repo.health.record(event, { ...vaccination, animalId: newId() })).rejects.toThrow('does not match')
  expect(await repo.health.list(animal.id)).toEqual([])
  await repo.health.record(event, vaccination)

  const duplicate = { ...event, id: newId() }
  await expect(repo.health.record(duplicate, { ...vaccination, healthEventId: duplicate.id })).rejects.toThrow()
  expect(await repo.health.get(duplicate.id)).toBeUndefined()
  await expect(repo.health.record(event, vaccination)).rejects.toThrow()

  const treatmentEvent = { ...event, id: newId(), kind: 'treatment' as const }
  const treatment: Treatment = {
    id: newId(), healthEventId: treatmentEvent.id, animalId: animal.id, medicineName: 'TEST', startedAt: timestamp,
  }
  await expect(repo.health.record(treatmentEvent, { ...treatment, endedAt: '2026-11-15T10:00:00Z' })).rejects.toThrow()
  await repo.health.record(treatmentEvent, treatment)
  await repo.animals.archive(animal.id)
  expect(await repo.health.list(animal.id)).toHaveLength(2)
  expect(await repo.health.get(event.id)).toEqual({ event, vaccination, treatment: undefined })
  expect(await repo.health.get(treatmentEvent.id)).toMatchObject({ treatment })
})

test('validates species, groups, tasks, settings and append-only audit events', async () => {
  expect(() => repo.species.save({ ...sheep, displayNameSq: '' })).toThrow()
  expect(() => repo.groups.save({ id: newId(), name: ' ', ...timestamps })).toThrow()
  expect(() => repo.settings.save({ key: 'language', value: 'fr', updatedAt: timestamp })).toThrow()
  const task = { title: 'TEST', dueDate: '2026-11-16', type: 'general' as const }
  await expect(repo.tasks.create({ ...task, dueDate: 'invalid' })).rejects.toThrow()
  await expect(repo.tasks.create({ ...task, animalId: newId() })).rejects.toThrow('Animal missing')
  const saved = await repo.tasks.create(task)
  expect(await repo.tasks.range()).toEqual([saved])
  const audit = { id: newId(), entityType: 'task', entityId: saved.id, action: 'create', occurredAt: timestamp, summary: 'Task created' }
  expect(() => repo.audit.append({ ...audit, summary: '' })).toThrow()
  await repo.audit.append(audit)
  await expect(repo.audit.append(audit)).rejects.toThrow()
  expect(await repo.audit.list('task', saved.id)).toEqual([audit])
})

test('demo seed is safe to retry and concurrent calls create one set', async () => {
  expect((await Promise.all([seedDemo(db), seedDemo(db)])).sort()).toEqual([false, true])
  expect((await repo.animals.list()).map(({ earTag }) => earTag).sort()).toEqual(['DEMO-001', 'DEMO-002', 'DEMO-003'])
  expect(await repo.species.list()).toHaveLength(1)
})

test('a conflicting demo tag leaves all other records unchanged', async () => {
  await repo.species.save(sheep)
  const original = await repo.animals.save(animalRecord('DEMO-002'))
  await expect(seedDemo(db)).rejects.toThrow('ear tag')
  expect(await repo.animals.list()).toEqual([original])
  expect(await repo.species.list()).toEqual([sheep])
  expect(await repo.settings.get('demoSeeded')).toBeUndefined()
})
