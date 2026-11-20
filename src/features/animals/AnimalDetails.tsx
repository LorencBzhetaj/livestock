import {getAccess} from '../auth/access'
import {Icon} from '../../components/Icon'
import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { strings } from '../../i18n/strings'
import { AnimalForm } from './AnimalForm'
import { HealthTimeline } from '../health/HealthTimeline'
import { AnimalPhoto, BackToAnimals, speciesName, useLocalQuery } from './shared'

async function readAnimal(id: string) {
  const animal = await repositories.animals.get(id)
  if (!animal) return null
  const [photo, species, groups, dam, sire] = await Promise.all([
    repositories.animals.getPhoto(id), repositories.species.list(), repositories.groups.list(),
    animal.damId ? repositories.animals.get(animal.damId) : undefined,
    animal.sireId ? repositories.animals.get(animal.sireId) : undefined,
  ])
  return { animal, photo, species, groups, dam, sire }
}

export function AnimalDetails({ language, editing = false }: { language: Language; editing?: boolean }) {
  const { id = '' } = useParams()
  const query = useCallback(() => readAnimal(id), [id])
  const result = useLocalQuery(query)
  const t = animalStrings[language]

  return (
    <div className="registry">
      <BackToAnimals language={language} />
      {result?.error && <p className="registry-error" role="alert">{strings[language].error}</p>}
      {!result && <p role="status">{strings[language].loading}</p>}
      {result?.data === null && <h1>{t.missing}</h1>}
      {result?.data && (editing
        ? <AnimalForm key={id} language={language} {...result.data} />
        : <Profile key={id} language={language} data={result.data} />)}
    </div>
  )
}

type ProfileData = NonNullable<Awaited<ReturnType<typeof readAnimal>>>

function Profile({ language, data }: { language: Language; data: ProfileData }) {
  const { animal, species, photo, groups, dam, sire } = data
  const readOnly=getAccess()?.role==='VETERINARIAN'
  const t = animalStrings[language]
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const item = species.find(({ id }) => id === animal.speciesId)
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' })
  const date = (value?: string) => value ? dateFormat.format(new Date(value)) : undefined
  const fields = [
    [t.earTag, animal.earTag], [t.species, item && speciesName(item, language)],
    [t.breed, animal.breed], [t.sex, t[animal.sex]],
    [t.birthDate, date(animal.birthDate)],
    [t.acquisitionDate, date(animal.acquisitionDate)], [t.source, animal.source],
    [t.group, groups.find(({ id }) => id === animal.groupId)?.name],
    [t.dam, dam && <Link className="registry-link" to={'/animals/' + dam.id}>{dam.earTag}</Link>],
    [t.sire, sire && <Link className="registry-link" to={'/animals/' + sire.id}>{sire.earTag}</Link>],
  ] as const

  async function archive() {
    setBusy(true)
    setError(false)
    try {
      await repositories.animals.archive(animal.id)
      setConfirm(false)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="registry-heading mt-2">
        <h1 className="min-w-0 break-words">{animal.name || animal.earTag}</h1>
        {!readOnly&&<Link to="edit" className="registry-action secondary">{t.edit}</Link>}
      </div>
      <p className="profile-meta"><span>{animal.earTag}</span><span className="status-label">{t[animal.status]}</span></p>
      <section className="panel profile-card">
        {photo?<AnimalPhoto image={photo} className="profile-portrait" alt={t.photo}/>:<div className="profile-placeholder"><Icon name="animals" className="size-16"/></div>}
        <div>
        <h2>{t.identification}</h2>
        <div className="mt-5">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-6">
            {fields.map(([label, value]) => (
              <div className="min-w-0" key={label}>
                <dt className="text-sm text-stone-700">{label}</dt>
                <dd className="break-words font-medium">{value ?? '—'}
                  {label === t.birthDate && animal.birthDate && animal.birthDateApproximate &&
                    <span className="block text-sm font-normal text-stone-700">{t.approximate}</span>}
                </dd>
              </div>
            ))}
          </dl>

        </div>
        </div>
        {animal.notes && <div className="col-span-full mt-5 border-t border-stone-200 pt-4">
          <h3 className="font-semibold">{t.notes}</h3>
          <p className="mt-1 whitespace-pre-wrap break-words">{animal.notes}</p>
        </div>}
      </section>
      <HealthTimeline animalId={animal.id} language={language} />
      <div className="mt-6 grid divide-y divide-stone-300 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {([t.breeding, t.production]).map((heading) => (
          <section key={heading} className="px-2 py-4 sm:px-4">
            <h2>{heading}</h2>
            <p className="mt-1 text-sm text-stone-700">{t.future}</p>
          </section>
        ))}
      </div>
      {!readOnly && animal.status !== 'archived' && <div className="mt-5 border-t border-stone-300 pt-4">
        {confirm ? (
          <>
            <p>{t.archiveHelp}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="registry-action danger" disabled={busy} onClick={() => void archive()}>{t.confirmArchive}</button>
              <button className="registry-action secondary" disabled={busy} onClick={() => setConfirm(false)}>{t.cancel}</button>
            </div>
          </>
        ) : <button className="registry-action secondary" onClick={() => setConfirm(true)}>{t.archive}</button>}
        {error && <p role="alert" className="registry-error mt-3">{strings[language].error}</p>}
      </div>}
    </>
  )
}
