import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { LivestockDatabase, schemaVersion } from '../src/db/database'
import type { VeterinaryEntry } from '../src/db/healthModels'
import type { Animal } from '../src/db/models'
import { createRepositories } from '../src/db/repositories'
import { groupByDueDate, isOverdue, localDay, monthDays, shiftDay, shiftMonth, weekday } from '../src/lib/calendar'
import { newId } from '../src/lib/identity'

const today = '2026-11-16'
const timestamp = '2026-11-16T23:30:00Z'
const times = { createdAt: timestamp, updatedAt: timestamp }
const draft = { title: 'Test task', type: 'general' as const, dueDate: today }
let db: LivestockDatabase
let repo: ReturnType<typeof createRepositories>
let animal: Animal

beforeEach(async () => {
  db = new LivestockDatabase(newId())
  repo = createRepositories(db)
  const id = newId()
  await repo.species.save({ id, code: 'goat', active: true, displayNameSq: 'Dhi', displayNameEn: 'Goat' })
  animal = await repo.animals.save({ id: newId(), speciesId: id, earTag: 'TEST-1', sex: 'female', status: 'active', ...times })
})
afterEach(() => db.delete())

async function record(entry: VeterinaryEntry, amendment?: { eventId: string; reason: string }) {
  const receipt = await repo.health.submit({ operationId: newId(), animalIds: [animal.id], batch: false, entry, amendment })
  return receipt.results[0].eventId
}

test('recorded overdue clinical dates remain readable without creating a duplicate task',async()=>{
 const event=await record({kind:'checkup',date:'2026-11-01',reason:'Synthetic visit',followUpDate:'2026-11-02'})
 expect(await repo.health.upcomingSources(today,'2026-12-01')).toHaveLength(0)
 expect(await repo.health.upcomingSources(undefined,'2026-12-01')).toMatchObject([{event:{id:event},dueDate:'2026-11-02'}])
 expect(await repo.tasks.range()).toHaveLength(0)
})

test('creates, edits and reschedules a task, then retains completion and cancellation history', async () => {
  const saved = await repo.tasks.create({ ...draft, animalId: animal.id, description: 'First' })
  await expect(repo.tasks.edit(saved.id, { ...draft, dueDate: '2026-02-30' })).rejects.toThrow()
  expect(await repo.tasks.get(saved.id)).toEqual(saved)
  const edited = await repo.tasks.edit(saved.id, { ...draft, title: 'Revised', dueDate: '2026-11-20' })
  expect(edited).toMatchObject({ id: saved.id, createdAt: saved.createdAt, title: 'Revised', dueDate: '2026-11-20' })
  expect(edited.animalId).toBeUndefined()
  expect(edited.description).toBeUndefined()
  expect(await repo.tasks.range({ from: today, to: today })).toEqual([])
  expect(await repo.tasks.range({ from: '2026-11-20', to: '2026-11-20' })).toEqual([edited])
  const completed = await repo.tasks.finish(saved.id, 'completed')
  expect(completed.completedAt).toBe(completed.updatedAt)
  await expect(repo.tasks.edit(saved.id, draft)).rejects.toMatchObject({ code: 'closed' })
  await expect(repo.tasks.finish(saved.id, 'cancelled')).rejects.toMatchObject({ code: 'closed' })
  const next = await repo.tasks.create(draft)
  const cancelled = await repo.tasks.finish(next.id, 'cancelled')
  expect(cancelled.completedAt).toBeUndefined()
  expect(await repo.tasks.range({ status: 'pending' })).toEqual([])
  expect(await repo.tasks.range({ status: 'cancelled' })).toEqual([cancelled])
  expect(await repo.tasks.range({ status: 'completed' })).toEqual([completed])
})

test('groups the calendar by local dates and marks only past pending entries overdue', () => {
  const old = { dueDate: '2026-11-15', status: 'pending' }
  const completed = { ...old, status: 'completed' }
  const due = { dueDate: today, status: 'pending' }
  expect(groupByDueDate([old, completed, due]).get(old.dueDate)).toEqual([old, completed])
  expect([old, completed, due].map((task) => isOverdue(task, today))).toEqual([true, false, false])
  expect(monthDays('2028-02-10')).toHaveLength(29)
  expect(weekday('2026-11-16')).toBe(0)
  expect(shiftMonth('2026-12-25', 1)).toBe('2027-01-01')
  expect(shiftDay('2026-10-25', 1)).toBe('2026-10-26')
})

test('retains date-only due days and distinguishes real instants at DST and timezone boundaries', () => {
  const moduleUrl = new URL('../src/lib/calendar.ts', import.meta.url).href
  function dates(zone: string) {
    const script = `import { localDay, recordedDay, shiftDay } from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify([
        localDay(new Date('2026-03-29T00:30:00Z')),
        localDay(new Date('2026-10-25T00:30:00Z')),
        recordedDay('2026-03-29T00:00:00Z', true),
        recordedDay('2026-10-25T00:00:00Z', true),
        shiftDay('2026-03-29', 1), shiftDay('2026-10-25', 1)
      ]))`
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, TZ: zone },
    }))
  }
  const sameDays = ['2026-03-29', '2026-10-25', '2026-03-30', '2026-10-26']
  expect(dates('Europe/Tirane')).toEqual(['2026-03-29', '2026-10-25', ...sameDays])
  expect(dates('America/Los_Angeles')).toEqual(['2026-03-28', '2026-10-24', ...sameDays])
})

test('creates explicit reminders only from recorded dates, including for archived animals', async () => {
  const vaccine = await record({ kind: 'vaccination', date: today, productName: 'Test vaccine' })
  await expect(repo.tasks.fromEvent({ eventId: vaccine, dueDate: today, title: 'Test' })).rejects.toMatchObject({ code: 'reminderChanged' })
  const checkup = await record({ kind: 'checkup', date: today, reason: 'Test visit', followUpDate: '2026-11-19' })
  const treatment = await record({ kind: 'treatment', date: today, reason: 'Test', medicineName: 'Test product',
    doseText: 'Recorded amount', doseUnit: 'Recorded unit', route: 'Recorded route', duration: 'Recorded duration',
    followUpDate: '2026-11-20' })
  expect(await repo.tasks.range()).toEqual([])
  await repo.animals.archive(animal.id)
  const check = await repo.tasks.fromEvent({ eventId: checkup, dueDate: '2026-11-19', title: 'Checkup' })
  const follow = await repo.tasks.fromEvent({ eventId: treatment, dueDate: '2026-11-20', title: 'Follow-up' })
  expect(check.task).toMatchObject({ animalId: animal.id, type: 'checkup', healthEventId: checkup })
  expect(follow.task.type).toBe('treatmentFollowUp')
  expect(await repo.tasks.range({ animalId: animal.id, status: 'pending' })).toHaveLength(2)
})

test('uses the latest valid amendment and prevents duplicates through the whole chain across tabs', async () => {
  const entry = { kind: 'vaccination', date: today, productName: 'Test vaccine', nextDueAt: '2026-11-19' } as const
  const root = await record(entry)
  const amended = await record({ ...entry, nextDueAt: '2026-11-21' }, { eventId: root, reason: 'Transcription' })
  expect(await repo.health.reminderSource(root)).toMatchObject({ rootId: root, event: { id: amended }, dueDate: '2026-11-21' })
  await expect(repo.tasks.fromEvent({ eventId: root, dueDate: '2026-11-19', title: 'Vaccine' })).rejects.toMatchObject({ code: 'reminderChanged' })
  const peer = new LivestockDatabase(db.name)
  try {
    const request = { eventId: root, dueDate: '2026-11-21', title: 'Vaccine' }
    const results = await Promise.all([
      repo.tasks.fromEvent(request), createRepositories(peer).tasks.fromEvent({ ...request, eventId: amended }),
    ])
    expect(results.map(({ created }) => created).sort()).toEqual([false, true])
    expect(results[0].task.id).toBe(results[1].task.id)
    const task = results[0].task
    await expect(repo.tasks.edit(task.id, draft)).rejects.toMatchObject({ code: 'linked' })
    const third = await record({ ...entry, nextDueAt: undefined }, { eventId: amended, reason: 'Date withdrawn' })
    expect((await repo.health.latest(task.healthEventId!))?.event.id).toBe(third)
    expect(await repo.health.reminderSource(root)).toBeUndefined()
    expect((await repo.tasks.get(task.id))?.dueDate).toBe('2026-11-21')
    await repo.tasks.finish(task.id, 'cancelled')
    expect(await repo.tasks.range()).toHaveLength(1)
    const fourth = await record(entry, { eventId: third, reason: 'Date recorded again' })
    expect(await repo.tasks.fromEvent({ ...request, eventId: fourth, dueDate: entry.nextDueAt })).toMatchObject({
      created: false, task: { id: task.id, status: 'cancelled' },
    })
  } finally {
    peer.close()
  }
})

test('derives dashboard counts for 200 multi-species animals and indexed date windows', async () => {
  const sheep = { id: newId(), code: 'sheep' as const, displayNameSq: 'Dele', displayNameEn: 'Sheep', active: true }
  await repo.species.save(sheep)
  await repo.animals.import(Array.from({ length: 199 }, (_, index) => ({
    ...animal, id: newId(), earTag: 'DASH-' + index, speciesId: index < 149 ? animal.speciesId : sheep.id,
    status: index < 20 ? 'archived' as const : index === 20 ? 'sold' as const : 'active' as const,
  })))
  const tasks = await Promise.all([-1, 0, 1, 7, 8, 30, 31, -2].map((day) =>
    repo.tasks.create({ ...draft, title: 'Task ' + day, dueDate: shiftDay(today, day) }),
  ))
  await repo.tasks.finish(tasks[7].id, 'completed')
  const vaccine = await record({ kind: 'vaccination', date: today, productName: 'Test', nextDueAt: '2026-11-20' })
  const exam = await record({ kind: 'checkup', date: today, reason: 'Test', followUpDate: '2026-11-19' })
  const dashboard = await repo.dashboard(today)
  expect(dashboard).toMatchObject({ total: 200, active: 179, archived: 20,
    taskCounts: { overdue: 1, today: 1, week: 2, month: 4 } })
  expect(dashboard.speciesCounts.map(({ count }) => count).sort((a, b) => a - b)).toEqual([50, 150])
  expect(dashboard.clinicalDates.map(({ event }) => event.id)).toEqual([exam, vaccine])
  await repo.tasks.fromEvent({ eventId: vaccine, dueDate: '2026-11-20', title: 'Vaccine' })
  const updated = await repo.dashboard(today)
  expect(updated.clinicalDates.map(({ event }) => event.id)).toEqual([exam])
  expect(updated.clinicalTasks).toHaveLength(1)
  expect(updated.records).toHaveLength(2)
})

test('upgrades v3 in place while keeping animals, photos, settings, clinical records, receipts and original task timestamps', async () => {
  const legacy = new Dexie(newId())
  legacy.version(3).stores({
    species: 'id, code', animals: 'id, earTag, speciesId, status, groupId, [status+earTag]',
    groups: 'id, name', healthEvents: 'id, animalId, occurredAt, [animalId+occurredAt], batchId, &amendsId',
    vaccinations: 'id, &healthEventId, animalId, administeredAt, nextDueAt', treatments: 'id, &healthEventId, animalId, startedAt',
    tasks: 'id, animalId, dueAt, status, [status+dueAt]', settings: 'key',
    auditEvents: 'id, [entityType+entityId], occurredAt', animalPhotos: 'animalId', veterinaryOperations: 'id',
  })
  const event = { id: newId(), animalId: animal.id, kind: 'checkup', occurredAt: timestamp, ...times }
  const reminder = { id: newId(), title: 'Legacy', dueAt: timestamp, status: 'done', completedAt: timestamp, ...times }
  const receipt = { id: newId(), fingerprint: 'a'.repeat(64), results: [{ eventId: event.id, animalId: animal.id }] }
  await legacy.table('animals').add(animal)
  await legacy.table('animalPhotos').add({ animalId: animal.id, image: new Blob(['photo'], { type: 'image/png' }) })
  await legacy.table('healthEvents').add(event)
  await legacy.table('settings').add({ key: 'language', value: 'en', updatedAt: timestamp })
  await legacy.table('veterinaryOperations').add(receipt)
  await legacy.table('tasks').add(reminder)
  legacy.close()
  const upgraded = new LivestockDatabase(legacy.name)
  try {
    const migrated = createRepositories(upgraded)
    expect(await migrated.tasks.get(reminder.id)).toEqual({
      ...reminder, dueDate: localDay(new Date(timestamp)), type: 'general', status: 'completed',
    })
    expect(upgraded.verno).toBe(schemaVersion)
    expect(await migrated.animals.get(animal.id)).toEqual(animal)
    expect(await (await migrated.animals.getPhoto(animal.id))?.text()).toBe('photo')
    expect((await migrated.health.get(event.id))?.event).toEqual(event)
    expect(await migrated.settings.get('language')).toMatchObject({ value: 'en' })
    expect(await upgraded.veterinaryOperations.get(receipt.id)).toEqual(receipt)
  } finally {
    await upgraded.delete()
  }
})
