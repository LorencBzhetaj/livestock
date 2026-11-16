import type { HealthEvent, Language } from '../../db/models'
import { VeterinaryConflict } from '../../db/healthRepository'
import { healthStrings } from '../../i18n/health'
import { strings } from '../../i18n/strings'
import { Field } from '../animals/shared'
import { displayDate, entryFields } from './entry'

type FieldValues = Partial<Record<(typeof entryFields)[HealthEvent['kind']][number]['name'], string>>

export function HealthFields({ language, kind, values }: {
  language: Language
  kind: HealthEvent['kind']
  values?: FieldValues
}) {
  const t = healthStrings[language]
  return (
    <>
      {entryFields[kind].map(({ name, type, required }) => (
        <div key={name} className={type === 'textarea' ? 'sm:col-span-2' : 'min-w-0'}>
          <Field label={t[name]}>
            {type === 'textarea'
              ? <textarea className="registry-control" name={name} rows={3} required={required} defaultValue={values?.[name]} />
              : <input className="registry-control" name={name} type={type ?? 'text'} required={required}
                  defaultValue={values?.[name]} aria-describedby={name.endsWith('WithdrawalUntil') ? 'withdrawal-hint' : undefined} />}
          </Field>
        </div>
      ))}
      {kind === 'treatment' && <p id="withdrawal-hint" className="text-sm text-stone-700 sm:col-span-2">{t.withdrawalHint}</p>}
    </>
  )
}

export function HealthValues({ language, kind, values }: { language: Language; kind: HealthEvent['kind']; values: FieldValues }) {
  const t = healthStrings[language]
  return (
    <dl className="grid grid-cols-2 gap-4">
      {entryFields[kind].map(({ name, type }) => {
        const value = values[name]
        if (!value) return null
        return (
          <div key={name} className={type === 'textarea' ? 'col-span-2 min-w-0' : 'min-w-0'}>
            <dt className="text-sm text-stone-700">{t[name]}</dt>
            <dd className="whitespace-pre-wrap break-words font-medium">{type === 'date' ? displayDate(value, language) : value}</dd>
          </div>
        )
      })}
    </dl>
  )
}

export function submitError(error: unknown, language: Language) {
  const t = healthStrings[language]
  if (error instanceof VeterinaryConflict) {
    return { animals: t.unavailable, amendment: t.amendConflict, operation: t.operationConflict }[error.code]
  }
  return strings[language].error
}
