import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { veterinaryEntrySchema, type VeterinaryOperation, type VeterinaryReceipt } from '../../db/healthModels'
import type { Animal, Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { healthStrings } from '../../i18n/health'
import { strings } from '../../i18n/strings'
import { newId } from '../../lib/identity'
import { Field, speciesName, useLocalQuery } from '../animals/shared'
import { readEntry } from './entry'
import { HealthFields, HealthValues, submitError } from './HealthFields'
import { animalLabel } from './HealthTimeline'

async function readCandidates() {
  const [animals, species, groups] = await Promise.all([
    repositories.animals.list(), repositories.species.list(), repositories.groups.list(),
  ])
  return { animals: animals.filter(({ status }) => status === 'active'), species, groups }
}

export function BatchVaccination({ language }: { language: Language }) {
  const t = healthStrings[language]
  const [session, setSession] = useState(0)
  return (
    <div className="registry">
      <Link to="/veterinary" className="registry-link inline-flex min-h-11 items-center">{t.back}</Link>
      <h1 className="mt-2">{t.batch}</h1>
      <BatchForm key={session} language={language} reset={() => setSession(session + 1)} />
    </div>
  )
}

function BatchForm({ language, reset }: { language: Language; reset: () => void }) {
  const t = healthStrings[language]
  const labels = animalStrings[language]
  const result = useLocalQuery(readCandidates)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [speciesId, setSpecies] = useState('')
  const [selected, setSelected] = useState(new Set<string>())
  const [review, setReview] = useState<{ request: VeterinaryOperation; animals: Animal[] }>()
  const [receipt, setReceipt] = useState<VeterinaryReceipt>()
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const data = result?.data
  const animals = [...(data?.animals ?? [])].sort((a, b) => a.earTag.localeCompare(b.earTag, language, { numeric: true }))
  const chosen = animals.filter(({ id }) => selected.has(id))
  const search = query.trim().toLowerCase()
  const matches = animals.filter((animal) =>
    (!group || animal.groupId === group) && (!speciesId || animal.speciesId === speciesId) &&
    animalLabel(animal).toLowerCase().includes(search),
  )

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!chosen.length || locked.current) return
    const parsed = veterinaryEntrySchema.safeParse(readEntry('vaccination', new FormData(event.currentTarget)))
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map(({ path }) => t[path[0] as keyof typeof t] ?? t.kind))
      setErrors([...fields].map((label) => label + ' · ' + t.invalidField))
      return
    }
    setErrors([])
    setReview({
      animals: chosen,
      request: { batch: true, operationId: newId(), animalIds: chosen.map(({ id }) => id), entry: parsed.data },
    })
  }

  async function confirm() {
    if (!review || locked.current) return
    locked.current = true
    setBusy(true)
    setErrors([])
    try {
      setReceipt(await repositories.health.submit(review.request))
    } catch (error) {
      setErrors([submitError(error, language)])
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  if (!result) return <p className="mt-4" role="status">{strings[language].loading}</p>
  if (result.error) return <p className="registry-error mt-4" role="alert">{strings[language].error}</p>
  const reviewedAnimals = new Map(review?.animals.map((animal) => [animal.id, animalLabel(animal)]))
  if (receipt) return (
    <section className="panel mt-6">
      <h2 role="status">{t.savedCount} · {receipt.results.length}</h2>
      <p className="mt-3 break-all text-sm">{t.batchId} · {receipt.id}</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {receipt.results.map(({ animalId, eventId }) => (
          <li key={animalId} className="min-w-0 break-words">
            <Link className="registry-link" to={'/veterinary/events/' + eventId}>{reviewedAnimals.get(animalId) ?? animalId}</Link>
          </li>
        ))}
      </ul>
      <div className="mt-5"><button className="registry-action" onClick={reset}>{t.newBatch}</button></div>
    </section>
  )

  return (
    <>
      <form onSubmit={preview} hidden={Boolean(review)} className="mt-6 space-y-5">
        <section className="panel" aria-labelledby="batch-animals">
          <h2 id="batch-animals">{t.batchAnimals}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label={labels.search}>
              <input className="registry-control" type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            </Field>
            <Field label={labels.species}>
              <select className="registry-control" value={speciesId} onChange={(event) => setSpecies(event.currentTarget.value)}>
                <option value="">{labels.all}</option>
                {data?.species.map((item) => <option key={item.id} value={item.id}>{speciesName(item, language)}</option>)}
              </select>
            </Field>
            <Field label={labels.group}>
              <select className="registry-control" value={group} onChange={(event) => setGroup(event.currentTarget.value)}>
                <option value="">{labels.all}</option>
                {data?.groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="registry-action secondary" type="button" disabled={!matches.length}
              onClick={() => setSelected((current) => new Set([...current, ...matches.map(({ id }) => id)]))}>{t.selectMatches}</button>
            <button className="registry-action secondary" type="button" disabled={!selected.size}
              onClick={() => setSelected(new Set())}>{t.clearSelection}</button>
            <p className="text-sm tabular-nums" role="status">{t.chosen} · {chosen.length}</p>
          </div>
          {matches.length ? (
            <ul className="mt-4 max-h-72 overflow-y-auto rounded-md border border-stone-300">
              {matches.map((animal) => (
                <li key={animal.id} className="border-b border-stone-200 last:border-0">
                  <label className="flex min-h-11 items-center gap-3 px-3 py-2 hover:bg-green-50">
                    <input type="checkbox" checked={selected.has(animal.id)}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked
                        setSelected((current) => {
                          const next = new Set(current)
                          if (checked) next.add(animal.id)
                          else next.delete(animal.id)
                          return next
                        })
                      }} />
                    <span className="min-w-0 break-words">{animalLabel(animal)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3">{t.noActive}</p>}
        </section>
        <section className="panel">
          <h2>{t.vaccination}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2"><HealthFields language={language} kind="vaccination" /></div>
          <div className="mt-5"><button className="registry-action" disabled={!chosen.length}>{t.preview}</button></div>
        </section>
      </form>
      {review && (
        <section className="panel mt-6" aria-labelledby="batch-review">
          <h2 id="batch-review">{t.review}</h2>
          <div className="mt-4"><HealthValues language={language} kind="vaccination" values={review.request.entry} /></div>
          <h3 id="batch-chosen" className="mt-5 font-semibold">{t.chosen} · {review.animals.length}</h3>
          <ol aria-labelledby="batch-chosen" tabIndex={0} className="mt-2 max-h-72 list-decimal overflow-y-auto rounded-md border border-stone-300 py-2 pl-10 pr-3">
            {review.animals.map((animal) => <li key={animal.id} className="break-words py-1">{animalLabel(animal)}</li>)}
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="registry-action" disabled={busy} onClick={() => void confirm()}>{busy ? strings[language].saving : t.confirm}</button>
            <button className="registry-action secondary" disabled={busy} onClick={() => { setReview(undefined); setErrors([]) }}>{t.editBatch}</button>
          </div>
        </section>
      )}
      {errors.length > 0 && <ul role="alert" className="registry-error mt-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
    </>
  )
}
