import type { LivestockDatabase } from './database'
import { healthEventSchema, treatmentSchema, vaccinationSchema, type HealthEvent, type Treatment, type Vaccination } from './models'
import { fingerprintVeterinaryOperation, veterinaryOperationSchema, veterinaryReceiptSchema, type VeterinaryEntry, type VeterinaryOperation } from './healthModels'
import { newId, now } from '../lib/identity'
import { recordedDay, shiftDay } from '../lib/calendar'
import type { TaskType } from './taskModels'

export class VeterinaryConflict extends Error {
  constructor(readonly code: 'operation' | 'animals' | 'amendment') {
    super(code)
  }
}

const utc = (date: string) => date + 'T00:00:00.000Z'
const optionalUtc = (date?: string) => date && utc(date)

function makeRecord(animalId: string, entry: VeterinaryEntry, operation: VeterinaryOperation, timestamp: string) {
  const eventId = newId()
  const occurredAt = utc(entry.date)
  const common = { animalId, vetName: entry.vetName, notes: entry.notes }
  const clinical = entry.kind === 'checkup' || entry.kind === 'illness' || entry.kind === 'followUp'
    ? { reason: entry.reason, symptoms: entry.symptoms, findings: entry.findings, diagnosis: entry.diagnosis,
        followUpAt: optionalUtc(entry.followUpDate) }
    : entry.kind === 'treatment' ? { followUpAt: optionalUtc(entry.followUpDate) } : {}
  const event = healthEventSchema.parse({
    ...common, ...clinical, id: eventId, kind: entry.kind, occurredAt, dateOnly: true,
    batchId: operation.batch ? operation.operationId : undefined,
    amendsId: operation.amendment?.eventId, amendmentReason: operation.amendment?.reason,
    createdAt: timestamp, updatedAt: timestamp,
  })
  const linked = { ...common, id: newId(), healthEventId: eventId }
  const vaccination = entry.kind === 'vaccination' ? vaccinationSchema.parse({
    ...linked, productName: entry.productName, batchNumber: entry.batchNumber, manufacturer: entry.manufacturer,
    doseText: entry.doseText, route: entry.route, administeredAt: occurredAt, nextDueAt: optionalUtc(entry.nextDueAt),
  }) : undefined
  const treatment = entry.kind === 'treatment' ? treatmentSchema.parse({
    ...linked, medicineName: entry.medicineName, reason: entry.reason, doseText: entry.doseText,
    doseUnit: entry.doseUnit, route: entry.route, duration: entry.duration, startedAt: occurredAt,
    endedAt: optionalUtc(entry.endedAt), milkWithdrawalUntil: optionalUtc(entry.milkWithdrawalUntil),
    meatWithdrawalUntil: optionalUtc(entry.meatWithdrawalUntil),
  }) : undefined
  return { event, vaccination, treatment }
}

export function createHealthRepository(db: LivestockDatabase) {
  const records = [db.healthEvents, db.vaccinations, db.treatments]

  async function lineage(id: string) {
    const event = await db.healthEvents.get(id)
    if (!event) return undefined
    const seen = new Set([event.id])
    const compatible = (candidate: HealthEvent) => candidate.animalId === event.animalId && candidate.kind === event.kind
    let root = event
    while (root.amendsId) {
      const parent = await db.healthEvents.get(root.amendsId)
      if (!parent || seen.has(parent.id) || !compatible(parent)) return undefined
      seen.add(parent.id)
      root = parent
    }
    let latest = root
    seen.clear()
    seen.add(root.id)
    while (true) {
      const next = await db.healthEvents.get({ amendsId: latest.id })
      if (!next || seen.has(next.id) || !compatible(next) || !next.amendmentReason) break
      seen.add(next.id)
      latest = next
    }
    return { rootId: root.id, event: latest }
  }

  async function reminderSource(id: string) {
    return db.transaction('r', [db.healthEvents, db.vaccinations], async () => {
      const source = await lineage(id)
      if (!source) return undefined
      const { event } = source
      if (event.kind === 'vaccination') {
        const detail = await db.vaccinations.get({ healthEventId: event.id })
        if (!detail?.nextDueAt || detail.animalId !== event.animalId) return undefined
        return { ...source, type: 'vaccination' as const, dueDate: recordedDay(detail.nextDueAt, event.dateOnly) }
      }
      if (!event.followUpAt) return undefined
      const type: TaskType | undefined = event.kind === 'treatment' ? 'treatmentFollowUp'
        : event.kind === 'checkup' || event.kind === 'followUp' ? 'checkup' : undefined
      return type ? { ...source, type, dueDate: recordedDay(event.followUpAt, event.dateOnly) } : undefined
    })
  }

  return {
    latest: (id: string) => db.transaction('r', db.healthEvents, async () => await lineage(id)),
    reminderSource,
    upcomingSources: (from: string, to: string) => db.transaction('r', [db.healthEvents, db.vaccinations], async () => {
      // Include adjacent UTC days for legacy instant-based dates displayed locally.
      const lower = shiftDay(from, -1)
      const upper = shiftDay(to, 2)
      const [vaccinations, followUps] = await Promise.all([
        db.vaccinations.where('nextDueAt').between(lower, upper).toArray(),
        db.healthEvents.where('followUpAt').between(lower, upper).toArray(),
      ])
      const candidates = new Set([...vaccinations.map(({ healthEventId }) => healthEventId), ...followUps.map(({ id }) => id)])
      const sources = await Promise.all([...candidates].map(reminderSource))
      return [...new Map(sources.flatMap((source) =>
        source && source.dueDate >= from && source.dueDate <= to ? [[source.rootId, source] as const] : [],
      )).values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    }),
    list: (animalId: string) => db.healthEvents.where('animalId').equals(animalId).toArray(),
    recent: (limit = 100) => db.healthEvents.orderBy('occurredAt').reverse().limit(limit).toArray(),
    amendmentOf: (id: string) => db.healthEvents.get({ amendsId: id }),
    get: (id: string) => db.transaction('r', records, async () => {
      const event = await db.healthEvents.get(id)
      if (!event) return undefined
      const [vaccination, treatment] = await Promise.all([
        db.vaccinations.get({ healthEventId: id }), db.treatments.get({ healthEventId: id }),
      ])
      return { event, vaccination, treatment }
    }),
    record: (input: HealthEvent, detail?: Vaccination | Treatment) =>
      db.transaction('rw', [db.animals, ...records], async () => {
        const event = healthEventSchema.parse(input)
        if (event.amendsId || event.amendmentReason) throw new VeterinaryConflict('amendment')
        const vaccination = event.kind === 'vaccination' ? vaccinationSchema.parse(detail) : undefined
        const treatment = event.kind === 'treatment' ? treatmentSchema.parse(detail) : undefined
        const linked = vaccination ?? treatment
        if (detail && (!linked || linked.healthEventId !== event.id || linked.animalId !== event.animalId)) {
          throw new Error('Health event detail does not match')
        }
        if (!await db.animals.get(event.animalId)) throw new Error('Animal missing')
        await db.healthEvents.add(event)
        if (vaccination) await db.vaccinations.add(vaccination)
        if (treatment) await db.treatments.add(treatment)
        return event
      }),
    async submit(input: VeterinaryOperation) {
      const operation = veterinaryOperationSchema.parse(input)
      // Hash outside IndexedDB so the transaction never waits for Web Crypto.
      const hash = await fingerprintVeterinaryOperation(operation)
      const { animalIds, entry, amendment, batch } = operation
      return db.transaction('rw', [db.animals, ...records, db.veterinaryOperations], async () => {
        const prior = await db.veterinaryOperations.get(operation.operationId)
        if (prior) {
          if (prior.fingerprint !== hash) throw new VeterinaryConflict('operation')
          return prior
        }
        const animals = await db.animals.bulkGet(animalIds)
        if (animals.some((animal) => !animal || (batch && animal.status !== 'active'))) {
          throw new VeterinaryConflict('animals')
        }
        if (amendment) {
          const original = await db.healthEvents.get(amendment.eventId)
          if (!original || original.animalId !== animalIds[0] || original.kind !== entry.kind ||
              await db.healthEvents.get({ amendsId: original.id })) {
            throw new VeterinaryConflict('amendment')
          }
        }
        const timestamp = now()
        const entries = animalIds.map((animalId) => makeRecord(animalId, entry, operation, timestamp))
        const receipt = veterinaryReceiptSchema.parse({
          id: operation.operationId, fingerprint: hash,
          results: entries.map(({ event }) => ({ animalId: event.animalId, eventId: event.id })),
        })
        await db.healthEvents.bulkAdd(entries.map(({ event }) => event))
        if (entry.kind === 'vaccination') await db.vaccinations.bulkAdd(entries.flatMap(({ vaccination }) => vaccination ? [vaccination] : []))
        if (entry.kind === 'treatment') await db.treatments.bulkAdd(entries.flatMap(({ treatment }) => treatment ? [treatment] : []))
        await db.veterinaryOperations.add(receipt)
        return receipt
      })
    },
  }
}

export type VeterinaryRecord = NonNullable<Awaited<ReturnType<ReturnType<typeof createHealthRepository>['get']>>>
