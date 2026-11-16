import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { AnimalTagConflict } from '../src/db/animalTags'
import { LivestockDatabase, schemaVersion } from '../src/db/database'
import type { Animal, Species } from '../src/db/models'
import { createRepositories } from '../src/db/repositories'
import { csvTemplate, previewCsv } from '../src/features/animals/csv'
import { ageInYears, emptyFilters, filterAnimals } from '../src/features/animals/registry'
import { newId } from '../src/lib/identity'

const timestamp = '2026-11-16T10:00:00Z'
const times = { createdAt: timestamp, updatedAt: timestamp }
let db: LivestockDatabase
let repo: ReturnType<typeof createRepositories>
let species: Species[]
let goat: Species

beforeEach(async () => {
  db = new LivestockDatabase(newId())
  repo = createRepositories(db)
  const existingGoat: Species = {
    id: newId(), code: 'goat', active: true, displayNameSq: 'Dhi', displayNameEn: 'Goat',
  }
  await repo.species.save(existingGoat)
  await Promise.all([repo.species.ensureCatalog(), repo.species.ensureCatalog()])
  species = await repo.species.list()
  goat = existingGoat
})
afterEach(() => db.delete())

function record(earTag: string, fields: Partial<Animal> = {}): Animal {
  return { id: newId(), earTag, speciesId: goat.id, sex: 'female', status: 'active', ...times, ...fields }
}

test('adds the reference catalog idempotently without replacing an existing goat species or creating animals', async () => {
  expect(species.map(({ code }) => code).sort()).toEqual(['cattle', 'goat', 'other', 'sheep'])
  expect(species.find(({ code }) => code === 'goat')).toEqual(goat)
  expect(await repo.animals.list()).toEqual([])
})

test('edits and archives an animal while retaining its ID, photo and veterinary history', async () => {
  const photo = new Blob(['photo bytes'], { type: 'image/png' })
  const animal = await repo.animals.save(record(' al-8 '), photo)
  const health = await repo.health.record({
    id: newId(), animalId: animal.id, kind: 'checkup', occurredAt: timestamp, ...times,
  })
  const updatedAt = '2026-11-17T09:00:00Z'
  const saved = await repo.animals.save({ ...animal, name: 'Bora', updatedAt })
  expect(saved).toMatchObject({ id: animal.id, name: 'Bora', earTag: 'AL-8', createdAt: timestamp, updatedAt })
  await expect(repo.animals.save({ ...saved, name: 'Bad edit' }, new Blob(['html'], { type: 'text/html' }))).rejects.toThrow()
  expect(await repo.animals.get(animal.id)).toMatchObject({ name: 'Bora' })
  await repo.animals.archive(animal.id)
  expect(await repo.animals.get(animal.id)).toMatchObject({ status: 'archived' })
  expect(await repo.health.list(animal.id)).toEqual([health])
  expect(await (await repo.animals.getPhoto(animal.id))?.text()).toBe('photo bytes')
  await repo.animals.save({ ...saved, status: 'archived' }, null)
  expect(await repo.animals.getPhoto(animal.id)).toBeUndefined()
})

test('upgrades an actual Dexie v1 database with animals, photos initially absent and existing history intact', async () => {
  const name = newId()
  const legacy = new Dexie(name)
  legacy.version(1).stores({
    species: 'id, code', animals: 'id, earTag, speciesId, status, groupId, [status+earTag]',
    groups: 'id, name', healthEvents: 'id, animalId, occurredAt, [animalId+occurredAt], batchId',
    vaccinations: 'id, &healthEventId, animalId, administeredAt, nextDueAt', treatments: 'id, &healthEventId, animalId, startedAt',
    tasks: 'id, animalId, dueAt, status, [status+dueAt]', settings: 'key', auditEvents: 'id, [entityType+entityId], occurredAt',
  })
  const animal = record('MIGRATION')
  const health = { id: newId(), animalId: animal.id, kind: 'checkup', occurredAt: timestamp, ...times }
  await legacy.table('species').add(goat)
  await legacy.table('animals').add(animal)
  await legacy.table('healthEvents').add(health)
  await legacy.table('settings').add({ key: 'language', value: 'en', updatedAt: timestamp })
  legacy.close()
  const upgraded = new LivestockDatabase(name)
  try {
    const migrated = createRepositories(upgraded)
    expect(await migrated.animals.get(animal.id)).toEqual(animal)
    expect(upgraded.verno).toBe(schemaVersion)
    expect(await migrated.animals.getPhoto(animal.id)).toBeUndefined()
    expect(await migrated.health.list(animal.id)).toEqual([health])
    expect(await migrated.settings.get('language')).toMatchObject({ value: 'en' })
  } finally {
    await upgraded.delete()
  }
})

test('combines search with species, breed, sex, age, status and group filters', () => {
  const sheep = species.find(({ code }) => code === 'sheep')!
  const groupId = newId()
  const match = record('AL-1', { name: 'Bora', breed: 'Alpine', birthDate: '2024-11-17', groupId })
  const animals = [
    match, record('AL-2', { name: 'Bora', speciesId: sheep.id }),
    record('AL-3', { breed: 'Alpine', status: 'archived', sex: 'male' }),
  ]
  const today = '2026-11-16'
  expect(ageInYears(match.birthDate, today)).toBe(1)
  expect(ageInYears('2026-11-17', today)).toBeUndefined()
  expect(filterAnimals(animals, {
    search: ' bora ', speciesId: goat.id, breed: 'Alpine', sex: 'female', age: 'oneToThree', status: 'active', groupId,
  }, today)).toEqual([match])
  expect(filterAnimals(animals, { ...emptyFilters, search: 'al-3', age: 'ageUnknown', status: 'archived' }, today)).toEqual([animals[2]])
  expect(filterAnimals(animals, { ...emptyFilters, age: 'fourPlus' }, today)).toEqual([])
})

test('previews UTF-8 BOM, comma quotes, multiline values and physical row numbers', () => {
  const file = '\uFEFF' + csvTemplate + ' al-1 ,goat,female,"Bora, ""Jr""",,2024-11-17,2025-01-01,,"First\r\nSecond"\r\nAL-2,sheep,male,,,,,,\r\n'
  const preview = previewCsv(file, species, [])
  expect(preview.rows.map(({ line, issues }) => [line, issues])).toEqual([[2, []], [4, []]])
  expect(preview.rows[0].animal).toMatchObject({ earTag: 'AL-1', name: 'Bora, "Jr"', notes: 'First\nSecond', status: 'active' })
  expect(preview.rows[1].animal?.speciesId).toBe(species.find(({ code }) => code === 'sheep')?.id)
})

test('reports invalid required fields, malformed rows, invalid dates and both kinds of duplicates', () => {
  const result = previewCsv('earTag,species,sex,birthDate\n al-1 ,goat,female,2026-02-30\nAL-1,duck,,\n,goat,male\n"bad,goat,female', species, ['AL-1'])
  expect(result.rows.map(({ issues }) => issues)).toEqual([
    [{ key: 'invalidField', field: 'birthDate' }, { key: 'existingTag' }, { key: 'repeatedTag' }],
    [{ key: 'invalidField', field: 'species' }, { key: 'invalidField', field: 'sex' }, { key: 'existingTag' }, { key: 'repeatedTag' }],
    [{ key: 'malformedRow' }, { key: 'invalidField', field: 'earTag' }],
    [{ key: 'malformedRow' }, { key: 'invalidField', field: 'species' }, { key: 'invalidField', field: 'sex' }],
  ])
  expect(previewCsv('earTag,sex\nA,female', species, []).fileIssue).toBe('invalidHeader')
  expect(previewCsv(csvTemplate, species, []).fileIssue).toBe('emptyFile')
})

test('imports 200 only after commit, blocks repeats and stale conflicts, and rolls back on a late write failure', async () => {
  const file = 'earTag,species,sex\n' + Array.from({ length: 200 }, (_, index) => 'TAG-' + index + ',goat,female').join('\n')
  const preview = previewCsv(file, species, [])
  const batch = preview.rows.map(({ animal }) => animal!)
  expect(preview.rows.every(({ issues }) => !issues.length)).toBe(true)
  expect(await repo.animals.list()).toHaveLength(0)
  const [first, second] = batch
  await repo.animals.save({ ...second, status: 'archived' })
  await expect(repo.animals.import(batch)).rejects.toMatchObject({ earTag: second.earTag })
  await expect(repo.animals.import([first, { ...first, id: newId(), earTag: ' tag-0 ' }])).rejects.toBeInstanceOf(AnimalTagConflict)
  await expect(repo.animals.import([first, { ...second, earTag: 'ANOTHER' }])).rejects.toThrow()
  expect((await repo.animals.list()).map(({ earTag }) => earTag)).toEqual([second.earTag])
  await repo.animals.import([first, ...batch.slice(2), record('FINAL')])
  expect(await repo.animals.countActive()).toBe(200)
})
