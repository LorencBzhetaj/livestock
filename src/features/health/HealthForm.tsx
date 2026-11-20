import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { VeterinaryRecord } from '../../db/healthRepository'
import { veterinaryEntrySchema, type VeterinaryOperation } from '../../db/healthModels'
import { healthKinds, type Animal, type HealthEvent, type Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { healthStrings } from '../../i18n/health'
import { strings } from '../../i18n/strings'
import { newId } from '../../lib/identity'
import { Field, useLocalQuery } from '../animals/shared'
import { recordFields, readEntry } from './entry'
import { HealthFields, submitError } from './HealthFields'
import { animalLabel } from './HealthTimeline'

export function NewHealthEvent({ language }: { language: Language }) {
  const [params] = useSearchParams()
  const animalId = params.get('animal') ?? undefined
  const result = useLocalQuery(repositories.animals.list)
  if (result?.error) return <p role="alert">{strings[language].error}</p>
  if (!result?.data) return <p role="status">{strings[language].loading}</p>
  const animal = result.data.find(({ id }) => id === animalId)
  if (animalId && !animal) return <p role="alert">{animalStrings[language].missing}</p>
  return <HealthForm key={animalId} language={language} animals={result.data} animal={animal} />
}

export function HealthForm({ language, animals, animal, original }: {
  language: Language
  animals?: Animal[]
  animal?: Animal
  original?: VeterinaryRecord
}) {
  const t = healthStrings[language]
  const labels = animalStrings[language]
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedKind = params.get('kind') === 'vaccination' ? 'vaccination' : 'checkup'
  const [kind, setKind] = useState<HealthEvent['kind']>(original?.event.kind ?? requestedKind)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const locked = useRef(false)
  const retry = useRef<{ fingerprint: string; id: string }>(undefined)
  const cancel = original ? '/veterinary/events/' + original.event.id : animal ? '/animals/' + animal.id : '/veterinary'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    const form = new FormData(event.currentTarget)
    const entry = veterinaryEntrySchema.safeParse(readEntry(kind, form))
    if (!entry.success) {
      const fields = new Set(entry.error.issues.map(({ path }) => t[path[0] as keyof typeof t] ?? t.kind))
      setErrors([...fields].map((label) => label + ' · ' + t.invalidField))
      return
    }
    const reason = String(form.get('amendmentReason') ?? '').trim()
    if (original && !reason) {
      setErrors([t.amendmentReason + ' · ' + t.invalidField])
      return
    }
    const request: Omit<VeterinaryOperation, 'operationId'> = {
      batch: false, animalIds: [animal?.id ?? String(form.get('animal') ?? '')], entry: entry.data,
      amendment: original ? { eventId: original.event.id, reason } : undefined,
    }
    const fingerprint = JSON.stringify(request)
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, id: newId() }
    locked.current = true
    setBusy(true)
    setErrors([])
    try {
      const saved = await repositories.health.submit({ ...request, operationId: retry.current.id })
      navigate('/veterinary/events/' + saved.results[0].eventId, { replace: true })
    } catch (error) {
      setErrors([submitError(error, language)])
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return (
    <div className="registry">
      <Link to={cancel} className="registry-link inline-flex min-h-11 items-center">{original ? t.details : animal ? t.profile : t.back}</Link>
      <h1 className="mt-2">{original ? t.amend : t.add}</h1>
      {animal && <p className="mt-2 break-words">{animalLabel(animal)} · {labels[animal.status]}</p>}
      {original && <p className="mt-2">{t.amendmentHelp}</p>}
      {!animal && !animals?.length ? <p className="panel mt-6">{strings[language].empty}</p> : (
        <form className="panel mt-6 max-w-3xl" onSubmit={submit}>
          <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2" aria-label={original ? t.amendment : t.kind}>
            {!animal && <Field label={t.animal}>
              <select name="animal" className="registry-control" required defaultValue="">
                <option value="">{labels.select}</option>
                {[...(animals ?? [])].sort((a, b) => a.earTag.localeCompare(b.earTag, language, { numeric: true }))
                  .map((item) => <option key={item.id} value={item.id}>{animalLabel(item)} · {labels[item.status]}</option>)}
              </select>
            </Field>}
            {!original && <Field label={t.kind}>
              <select className="registry-control" value={kind} onChange={(event) => setKind(event.currentTarget.value as HealthEvent['kind'])}>
                {healthKinds.map((item) => <option key={item} value={item}>{t[item]}</option>)}
              </select>
            </Field>}
            <HealthFields language={language} kind={kind} values={original && recordFields(original)} />
            {original && <div className="sm:col-span-2">
              <Field label={t.amendmentReason}>
                <textarea name="amendmentReason" className="registry-control" rows={3} required />
              </Field>
            </div>}
          </fieldset>
          {errors.length > 0 && <ul role="alert" className="registry-error mt-4">{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button disabled={busy} className="registry-action">{busy ? strings[language].saving : t.save}</button>
            <Link to={cancel} className="registry-action secondary">{labels.cancel}</Link>
          </div>
        </form>
      )}
    </div>
  )
}
