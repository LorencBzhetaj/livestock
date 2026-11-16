import { fingerprintVeterinaryOperation, veterinaryEntrySchema, veterinaryOperationSchema } from '../../db/healthModels'
import { BackupError, type BackupData } from './format'

function day(value: string | undefined) {
  if (!value) return undefined
  if (!value.endsWith('T00:00:00.000Z')) throw new BackupError('relationships')
  return value.slice(0, 10)
}

export async function validateReceiptFingerprints(data: BackupData) {
  const events = new Map(data.healthEvents.map((event) => [event.id, event]))
  const vaccines = new Map(data.vaccinations.map((detail) => [detail.healthEventId, detail]))
  const treatments = new Map(data.treatments.map((detail) => [detail.healthEventId, detail]))
  for (const receipt of data.veterinaryOperations) {
    let first: ReturnType<typeof veterinaryEntrySchema.parse> | undefined
    const root = events.get(receipt.results[0].eventId)!
    for (const { eventId } of receipt.results) {
      const event = events.get(eventId)!
      if (!event.dateOnly) throw new BackupError('relationships')
      const vaccine = vaccines.get(eventId)
      const treatment = treatments.get(eventId)
      const detail = vaccine ?? treatment
      if (detail && (detail.vetName !== event.vetName || detail.notes !== event.notes ||
          (vaccine?.administeredAt ?? treatment?.startedAt) !== event.occurredAt)) {
        throw new BackupError('relationships')
      }
      const common = { kind: event.kind, date: day(event.occurredAt), vetName: event.vetName, notes: event.notes }
      const entry = vaccine ? {
        ...common, productName: vaccine.productName, batchNumber: vaccine.batchNumber, manufacturer: vaccine.manufacturer,
        doseText: vaccine.doseText, route: vaccine.route, nextDueAt: day(vaccine.nextDueAt),
      } : treatment ? {
        ...common, reason: treatment.reason, medicineName: treatment.medicineName, doseText: treatment.doseText,
        doseUnit: treatment.doseUnit, route: treatment.route, duration: treatment.duration, endedAt: day(treatment.endedAt),
        milkWithdrawalUntil: day(treatment.milkWithdrawalUntil), meatWithdrawalUntil: day(treatment.meatWithdrawalUntil),
        followUpDate: day(event.followUpAt),
      } : event.kind === 'other' ? common : {
        ...common, reason: event.reason, symptoms: event.symptoms, findings: event.findings,
        diagnosis: event.diagnosis, followUpDate: day(event.followUpAt),
      }
      const parsed = veterinaryEntrySchema.safeParse(entry)
      if (!parsed.success || (first && JSON.stringify(parsed.data) !== JSON.stringify(first))) {
        throw new BackupError('relationships')
      }
      first ??= parsed.data
    }
    const operation = veterinaryOperationSchema.safeParse({
      operationId: receipt.id, batch: Boolean(root.batchId), animalIds: receipt.results.map(({ animalId }) => animalId),
      entry: first, amendment: root.amendsId ? { eventId: root.amendsId, reason: root.amendmentReason } : undefined,
    })
    if (!operation.success || (await fingerprintVeterinaryOperation(operation.data)) !== receipt.fingerprint) {
      throw new BackupError('relationships')
    }
  }
}
