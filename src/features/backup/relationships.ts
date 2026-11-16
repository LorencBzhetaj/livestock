import { normalizeEarTag } from '../../db/animalTags'
import type { HealthEvent } from '../../db/models'
import { BackupError, type BackupData } from './format'

function uniqueBy<T, K>(rows: T[], key: (row: T) => K) {
  const index = new Map<K, T>()
  for (const row of rows) {
    const id = key(row)
    if (index.has(id)) throw new BackupError('duplicates')
    index.set(id, row)
  }
  return index
}

function requireRelation(valid: unknown) {
  if (!valid) throw new BackupError('relationships')
}

// Follow references iteratively, with a separate completed set to bound work on shared ancestors.
function acyclic(ids: Iterable<string>, parents: (id: string) => string[]) {
  const resolved = new Set<string>()
  for (const id of ids) {
    const stack = [{ id, exiting: false }]
    const visiting = new Set<string>()
    while (stack.length) {
      const item = stack.pop()!
      if (item.exiting) {
        visiting.delete(item.id)
        resolved.add(item.id)
      } else if (!resolved.has(item.id)) {
        requireRelation(!visiting.has(item.id))
        visiting.add(item.id)
        stack.push({ ...item, exiting: true })
        for (const parent of parents(item.id)) stack.push({ id: parent, exiting: false })
      }
    }
  }
}

function optionalIds(...ids: (string | undefined)[]) {
  return ids.filter((id): id is string => id !== undefined)
}

export function validateRelationships(data: BackupData) {
  const species = uniqueBy(data.species, ({ id }) => id)
  const groups = uniqueBy(data.groups, ({ id }) => id)
  const animals = uniqueBy(data.animals, ({ id }) => id)
  const events = uniqueBy(data.healthEvents, ({ id }) => id)
  const receipts = uniqueBy(data.veterinaryOperations, ({ id }) => id)
  uniqueBy(data.animalPhotos, ({ animalId }) => animalId)
  uniqueBy(data.vaccinations, ({ id }) => id)
  uniqueBy(data.treatments, ({ id }) => id)
  uniqueBy(data.tasks, ({ id }) => id)
  uniqueBy(data.settings, ({ key }) => key)
  uniqueBy(data.auditEvents, ({ id }) => id)
  uniqueBy(data.animals.filter(({ status }) => status === 'active'), ({ earTag }) => normalizeEarTag(earTag))

  for (const animal of animals.values()) {
    requireRelation(species.has(animal.speciesId) && (!animal.groupId || groups.has(animal.groupId)) &&
      optionalIds(animal.damId, animal.sireId).every((id) => animals.has(id)))
  }
  acyclic(animals.keys(), (id) => optionalIds(animals.get(id)?.damId, animals.get(id)?.sireId))
  for (const photo of data.animalPhotos) requireRelation(animals.has(photo.animalId))

  const vaccinations = uniqueBy(data.vaccinations, ({ healthEventId }) => healthEventId)
  const treatments = uniqueBy(data.treatments, ({ healthEventId }) => healthEventId)
  const amendments = data.healthEvents.filter(({ amendsId }) => amendsId)
  uniqueBy(amendments, ({ amendsId }) => amendsId)
  for (const event of events.values()) {
    const vaccine = vaccinations.get(event.id)
    const treatment = treatments.get(event.id)
    const parent = event.amendsId && events.get(event.amendsId)
    requireRelation(animals.has(event.animalId) &&
      (event.kind === 'vaccination') === Boolean(vaccine) && (event.kind === 'treatment') === Boolean(treatment) &&
      (!vaccine || vaccine.animalId === event.animalId) && (!treatment || treatment.animalId === event.animalId) &&
      Boolean(event.amendsId) === Boolean(event.amendmentReason) &&
      (!event.amendsId || (parent && parent.animalId === event.animalId && parent.kind === event.kind)) &&
      (!event.batchId || (event.kind === 'vaccination' && !event.amendsId && receipts.has(event.batchId))))
  }
  requireRelation([...vaccinations.keys(), ...treatments.keys()].every((id) => events.has(id)))
  acyclic(events.keys(), (id) => optionalIds(events.get(id)?.amendsId))

  const resultEvents = uniqueBy(data.veterinaryOperations.flatMap(({ results }) => results), ({ eventId }) => eventId)
  for (const receipt of receipts.values()) {
    uniqueBy(receipt.results, ({ animalId }) => animalId)
    const first = events.get(receipt.results[0].eventId)
    const isBatch = first?.batchId === receipt.id
    requireRelation(isBatch || receipt.results.length === 1)
    for (const result of receipt.results) {
      const event = events.get(result.eventId)
      requireRelation(event && event.animalId === result.animalId &&
        (isBatch ? event.batchId === receipt.id : !event.batchId))
    }
  }
  for (const event of events.values()) {
    if (event.batchId) requireRelation(resultEvents.has(event.id))
  }

  uniqueBy(data.tasks.filter(({ healthEventId }) => healthEventId), (task) => task.healthEventId + '/' + task.type)
  const reminderKind: Partial<Record<HealthEvent['kind'], string>> = {
    vaccination: 'vaccination', checkup: 'checkup', followUp: 'checkup', treatment: 'treatmentFollowUp',
  }
  for (const task of data.tasks) {
    requireRelation(!task.animalId || animals.has(task.animalId))
    if (task.healthEventId) {
      const event = events.get(task.healthEventId)
      requireRelation(event && !event.amendsId && event.animalId === task.animalId && reminderKind[event.kind] === task.type)
    }
  }
}
