import Dexie, { type EntityTable } from 'dexie'
import type { Animal, AnimalPhoto, AuditEvent, Group, HealthEvent, Setting, Species, Treatment, Vaccination } from './models'

import type { VeterinaryReceipt } from './healthModels'

import type { Task } from './taskModels'
import { migrateTask } from './migrateTasks'

export const schemaVersion = 4

export class LivestockDatabase extends Dexie {
  declare veterinaryOperations: EntityTable<VeterinaryReceipt, 'id'>
  declare animalPhotos: EntityTable<AnimalPhoto, 'animalId'>
  declare species: EntityTable<Species, 'id'>
  declare animals: EntityTable<Animal, 'id'>
  declare groups: EntityTable<Group, 'id'>
  declare healthEvents: EntityTable<HealthEvent, 'id'>
  declare vaccinations: EntityTable<Vaccination, 'id'>
  declare treatments: EntityTable<Treatment, 'id'>
  declare tasks: EntityTable<Task, 'id'>
  declare settings: EntityTable<Setting, 'key'>
  declare auditEvents: EntityTable<AuditEvent, 'id'>

  constructor(name = 'livestockos') {
    super(name)
    this.version(1).stores({
      species: 'id, code',
      animals: 'id, earTag, speciesId, status, groupId, [status+earTag]',
      groups: 'id, name',
      healthEvents: 'id, animalId, occurredAt, [animalId+occurredAt], batchId',
      vaccinations: 'id, &healthEventId, animalId, administeredAt, nextDueAt',
      treatments: 'id, &healthEventId, animalId, startedAt',
      tasks: 'id, animalId, dueAt, status, [status+dueAt]',
      settings: 'key',
      auditEvents: 'id, [entityType+entityId], occurredAt',
    })
    this.version(2).stores({ animalPhotos: 'animalId' })
    this.version(3).stores({
      healthEvents: 'id, animalId, occurredAt, [animalId+occurredAt], batchId, &amendsId',
      veterinaryOperations: 'id',
    })
    this.version(4).stores({
      tasks: 'id, animalId, dueDate, status, [status+dueDate], &[healthEventId+type]',
      healthEvents: 'id, animalId, occurredAt, [animalId+occurredAt], batchId, &amendsId, followUpAt',
    }).upgrade((transaction) => transaction.table('tasks').toCollection().modify((task, context) => {
      context.value = migrateTask(task)
    }))
  }
}
