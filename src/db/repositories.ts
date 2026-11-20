import { localDatabaseName, assertAdmin, getAccess } from '../features/auth/access'
import { farmWrite, journal } from '../features/sync/local'
import { newId, now } from '../lib/identity'
import { AnimalTagConflict, importTagIssues } from './animalTags'
import { speciesCatalog } from './speciesCatalog'
import { LivestockDatabase } from './database'
import { createHealthRepository } from './healthRepository'
import { createTaskRepository } from './taskRepository'
import { createDashboardRepository } from './dashboardRepository'
import {
  animalPhotoSchema, animalSchema, auditEventSchema, groupSchema, settingSchema,
  speciesSchema,
  type Animal, type AuditEvent, type Group, type Setting, type Species,
} from './models'

export function createRepositories(db: LivestockDatabase) {
  const health = createHealthRepository(db)
  const tasks = createTaskRepository(db, health)
  async function checkAnimal(animal: Animal) {
    if (!await db.species.get(animal.speciesId)) throw new Error('Species missing')
    if (animal.groupId && !await db.groups.get(animal.groupId)) throw new Error('Group missing')
    if (animal.status === 'active') {
      const duplicate = await db.animals.where('[status+earTag]').equals(['active', animal.earTag])
        .filter((record) => record.id !== animal.id).first()
      if (duplicate) throw new AnimalTagConflict(animal.earTag)
    }

    const visited = new Set<string>()
    const parents = [animal.damId, animal.sireId]
    while (parents.length) {
      const id = parents.pop()
      if (!id || visited.has(id)) continue
      if (id === animal.id) throw new Error('Parent links form a cycle')
      const parent = await db.animals.get(id)
      if (!parent) throw new Error('Parent missing')
      visited.add(id)
      parents.push(parent.damId, parent.sireId)
    }
  }

  return {
    animals: {
      getPhoto: async (animalId: string) => (await db.animalPhotos.get(animalId))?.image,
      list: () => db.animals.toArray(),
      get: (id: string) => db.animals.get(id),
      countActive: () => db.animals.where('status').equals('active').count(),
      save: (input: Animal, image?: Blob | null) =>
        farmWrite(db, [db.animals, db.species, db.groups, db.animalPhotos], async () => {
          const animal = animalSchema.parse(input)
          const photo = image ? animalPhotoSchema.parse({ animalId: animal.id, image }) : undefined
          const previous = await db.animals.get(animal.id)
          if (previous) animal.createdAt = previous.createdAt
          await checkAnimal(animal)
          await db.animals.put(animal)
          if (JSON.stringify(previous) !== JSON.stringify(animal)) await journal(db, [{ entity: 'animals', records: [animal] }])
          if (photo) await db.animalPhotos.put(photo)
          if (image === null) await db.animalPhotos.delete(animal.id)
          return animal
        }),
      import: (inputs: Animal[]) => farmWrite(db, [db.animals, db.species, db.groups], async () => {
        const animals = inputs.map((input) => animalSchema.parse(input))
        const tags = animals.map(({ earTag }) => earTag)
        const existing = await db.animals.where('earTag').anyOf(tags).uniqueKeys()
        const issues = importTagIssues(tags, existing.map(String))
        const conflict = issues.findIndex(({ existing, repeated }) => existing || repeated)
        if (conflict !== -1) throw new AnimalTagConflict(tags[conflict])
        for (const animal of animals) await checkAnimal(animal)
        await db.animals.bulkAdd(animals)
        await journal(db, [{ entity: 'animals', records: animals }])
      }),
      archive: (id: string) => farmWrite(db, [db.animals], async () => {
        const previous = await db.animals.get(id)
        if (!previous) throw new Error('Animal missing')
        if (previous.status === 'archived') return previous
        const animal = animalSchema.parse({ ...previous, status: 'archived', updatedAt: now() })
        await db.animals.put(animal)
        await journal(db, [{ entity: 'animals', records: [animal] }])
        return animal
      }),
    },
    species: {
      ensureCatalog: () => farmWrite(db, [db.species], async () => {
        if (getAccess()?.role === 'VETERINARIAN') return
        const existing = await db.species.toArray()
        const missing = speciesCatalog.filter(({ code }) => !existing.some((species) => species.code === code))
        if (missing.length) {
          const records = missing.map((item) => speciesSchema.parse({ ...item, id: newId() }))
          await db.species.bulkAdd(records)
          await journal(db, [{ entity: 'species', records }])
        }
      }),
      list: () => db.species.toArray(),
      save: (input: Species) => {
        const record = speciesSchema.parse(input)
        return farmWrite(db, [db.species], async () => {
          await db.species.put(record)
          await journal(db, [{ entity: 'species', records: [record] }])
          return record.id
        })
      },
    },
    groups: {
      list: () => db.groups.toArray(),
      save: (input: Group) => {
        const record = groupSchema.parse(input)
        return farmWrite(db, [db.groups], async () => {
          await db.groups.put(record)
          await journal(db, [{ entity: 'groups', records: [record] }])
          return record.id
        })
      },
    },
    health,
    tasks,
    dashboard: createDashboardRepository(db, health, tasks),
    settings: {
      get: (key: string) => db.settings.get(key),
      save: (input: Setting) => {
        if (input.key !== 'language') assertAdmin()
        return db.settings.put(settingSchema.parse(input))
      },
    },
    audit: {
      list: (entityType: string, entityId: string) =>
        db.auditEvents.where('[entityType+entityId]').equals([entityType, entityId]).toArray(),
      append: (input: AuditEvent) => db.auditEvents.add(auditEventSchema.parse(input)),
    },
  }
}

export const database = new LivestockDatabase(localDatabaseName())
export const repositories = createRepositories(database)

export async function seedDemo(db: LivestockDatabase) {
  const repo = createRepositories(db)
  return farmWrite(db, [db.animals, db.species, db.groups, db.settings, db.animalPhotos], async () => {
    if (await repo.settings.get('demoSeeded')) return false
    const timestamp = now()
    const goat = await db.species.where('code').equals('goat').first()
    const speciesId = goat?.id ?? newId()
    if (!goat) {
      await repo.species.save({ id: speciesId, code: 'goat', displayNameSq: 'Dhi', displayNameEn: 'Goat', active: true })
    }
    for (const earTag of ['DEMO-001', 'DEMO-002', 'DEMO-003']) {
      await repo.animals.save({
        id: newId(), earTag, speciesId, sex: 'female', status: 'active',
        createdAt: timestamp, updatedAt: timestamp,
      })
    }
    await repo.settings.save({ key: 'demoSeeded', value: true, updatedAt: timestamp })
    return true
  })
}
