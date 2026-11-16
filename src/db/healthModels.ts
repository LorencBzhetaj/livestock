import { z } from 'zod'
import { sha256 } from '../lib/sha256'

const required = z.string().trim().min(1)
const optional = required.optional()
const date = z.iso.date()
const common = { date, vetName: optional, notes: optional }
const visit = { reason: required, symptoms: optional, findings: optional, diagnosis: optional, followUpDate: date.optional() }

export const veterinaryEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('vaccination'), productName: required,
    batchNumber: optional, manufacturer: optional, doseText: optional, route: optional, nextDueAt: date.optional() }),
  z.strictObject({ ...common, kind: z.literal('treatment'), reason: required, medicineName: required,
    doseText: required, doseUnit: required, route: required, duration: required, endedAt: date.optional(),
    milkWithdrawalUntil: date.optional(), meatWithdrawalUntil: date.optional(), followUpDate: date.optional() }),
  z.strictObject({ ...common, ...visit, kind: z.literal('checkup') }),
  z.strictObject({ ...common, ...visit, kind: z.literal('illness') }),
  z.strictObject({ ...common, ...visit, kind: z.literal('followUp') }),
  z.strictObject({ ...common, kind: z.literal('other'), notes: required }),
]).superRefine((entry, context) => {
  function check(field: string, value?: string, earliest = entry.date) {
    if (value && value < earliest) context.addIssue({ code: 'custom', path: [field], message: 'Date precedes its minimum' })
  }
  if (entry.kind === 'vaccination') check('nextDueAt', entry.nextDueAt)
  else if (entry.kind === 'treatment') {
    check('endedAt', entry.endedAt)
    check('followUpDate', entry.followUpDate)
    check('milkWithdrawalUntil', entry.milkWithdrawalUntil, entry.endedAt ?? entry.date)
    check('meatWithdrawalUntil', entry.meatWithdrawalUntil, entry.endedAt ?? entry.date)
  } else if (entry.kind !== 'other') check('followUpDate', entry.followUpDate)
})

const id = z.uuid()
export const veterinaryOperationSchema = z.strictObject({
  operationId: id, batch: z.boolean(), animalIds: z.array(id).min(1),
  entry: veterinaryEntrySchema,
  amendment: z.strictObject({ eventId: id, reason: required }).optional(),
}).refine(({ batch, animalIds, entry, amendment }) => batch
  ? entry.kind === 'vaccination' && !amendment && animalIds.length === new Set(animalIds).size
  : animalIds.length === 1, 'Invalid operation scope')

export const veterinaryReceiptSchema = z.strictObject({
  id, fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  results: z.array(z.strictObject({ animalId: id, eventId: id })).min(1),
})

export type VeterinaryEntry = z.infer<typeof veterinaryEntrySchema>
export type VeterinaryOperation = z.infer<typeof veterinaryOperationSchema>
export type VeterinaryReceipt = z.infer<typeof veterinaryReceiptSchema>

export function fingerprintVeterinaryOperation(operation: VeterinaryOperation) {
  const canonical = { ...operation, animalIds: [...operation.animalIds].sort() }
  return sha256(new TextEncoder().encode(JSON.stringify(canonical)))
}
