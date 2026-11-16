import type { HealthEvent, Language } from '../../db/models'
import type { VeterinaryRecord } from '../../db/healthRepository'
import type { VeterinaryEntry } from '../../db/healthModels'

import { recordedDay } from '../../lib/calendar'

type EntryField = VeterinaryEntry extends infer Entry ? Entry extends VeterinaryEntry ? Exclude<keyof Entry, 'kind'> : never : never
type FieldSpec = { name: EntryField; type?: 'date' | 'textarea'; required?: true }
const common: FieldSpec[] = [{ name: 'date', type: 'date', required: true }, { name: 'vetName' }]
const notes: FieldSpec = { name: 'notes', type: 'textarea' }
const visit: FieldSpec[] = [
  { name: 'reason', required: true }, { name: 'symptoms', type: 'textarea' },
  { name: 'findings', type: 'textarea' }, { name: 'diagnosis' }, { name: 'followUpDate', type: 'date' },
]
export const entryFields: Record<HealthEvent['kind'], FieldSpec[]> = {
  vaccination: [...common, { name: 'productName', required: true }, { name: 'batchNumber' },
    { name: 'manufacturer' }, { name: 'doseText' }, { name: 'route' }, { name: 'nextDueAt', type: 'date' }, notes],
  treatment: [...common, { name: 'reason', required: true }, { name: 'medicineName', required: true },
    { name: 'doseText', required: true }, { name: 'doseUnit', required: true }, { name: 'route', required: true },
    { name: 'duration', required: true }, { name: 'endedAt', type: 'date' }, { name: 'followUpDate', type: 'date' },
    { name: 'milkWithdrawalUntil', type: 'date' }, { name: 'meatWithdrawalUntil', type: 'date' }, notes],
  checkup: [...common, ...visit, notes],
  illness: [...common, ...visit, notes],
  followUp: [...common, ...visit, notes],
  other: [...common, { ...notes, required: true }],
}

export function readEntry(kind: HealthEvent['kind'], form: FormData) {
  return {
    kind,
    ...Object.fromEntries(entryFields[kind].map(({ name }) => [name, String(form.get(name) ?? '').trim() || undefined])),
  }
}

export function recordFields({ event, vaccination, treatment }: VeterinaryRecord) {
  const values: Partial<Record<EntryField, string>> = {
    ...vaccination, ...treatment,
    vetName: event.vetName ?? vaccination?.vetName ?? treatment?.vetName,
    notes: event.notes ?? vaccination?.notes ?? treatment?.notes,
    date: recordedDay(event.occurredAt, event.dateOnly),
    reason: event.reason ?? treatment?.reason, symptoms: event.symptoms, findings: event.findings, diagnosis: event.diagnosis,
    followUpDate: event.followUpAt && recordedDay(event.followUpAt, event.dateOnly),
  }
  for (const { name, type } of entryFields[event.kind]) {
    if (type === 'date' && name !== 'date' && name !== 'followUpDate' && values[name]) {
      values[name] = recordedDay(values[name], event.dateOnly)
    }
  }
  return values
}

export function displayDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
}

export function displayTimestamp(value: string, language: Language) {
  return new Intl.DateTimeFormat(language, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value))
}

export function displayEventDate(event: HealthEvent, language: Language) {
  return event.dateOnly ? displayDate(event.occurredAt, language) : displayTimestamp(event.occurredAt, language)
}
