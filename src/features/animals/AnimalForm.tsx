import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimalTagConflict } from '../../db/animalTags'
import {
  animalPhotoSchema, animalSchema, animalSexes, animalStatuses, photoTypes,
  type Animal, type Group, type Language, type Species,
} from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { strings } from '../../i18n/strings'
import { newId, now } from '../../lib/identity'
import { AnimalPhoto, BackToAnimals, Field, fieldLabel, speciesName, useLocalQuery } from './shared'

async function readChoices() {
  const [species, groups] = await Promise.all([repositories.species.list(), repositories.groups.list()])
  return { species, groups }
}

export function NewAnimal({ language }: { language: Language }) {
  const result = useLocalQuery(readChoices)
  return (
    <div className="registry">
      <BackToAnimals language={language} />
      {result?.error && <p role="alert" className="registry-error">{strings[language].error}</p>}
      {!result && <p role="status">{strings[language].loading}</p>}
      {result?.data && <AnimalForm language={language} {...result.data} />}
    </div>
  )
}

export function AnimalForm({ language, animal, photo, species, groups }: {
  language: Language
  animal?: Animal
  photo?: Blob
  species: Species[]
  groups: Group[]
}) {
  const t = animalStrings[language]
  const navigate = useNavigate()
  const heading = animal ? t.edit : t.add
  const cancelTo = animal ? '/animals/' + animal.id : '/animals'
  const [image, setImage] = useState<File | null>()
  const preview = image === undefined ? photo : image
  const fileInput = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const value = (key: string) => String(form.get(key) ?? '').trim()
    const updatedAt = now()
    const id = animal?.id ?? newId()
    const parsed = animalSchema.safeParse({
      ...animal, id, createdAt: animal?.createdAt ?? updatedAt, updatedAt,
      earTag: value('earTag'), name: value('name') || undefined, speciesId: value('speciesId'),
      breed: value('breed') || undefined, sex: value('sex'), status: value('status'),
      birthDate: value('birthDate') || undefined, acquisitionDate: value('acquisitionDate') || undefined,
      birthDateApproximate: Boolean(value('birthDate') && form.has('approximate')),
      source: value('source') || undefined, groupId: value('groupId') || undefined, notes: value('notes') || undefined,
    })
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map(({ path }) => fieldLabel(path[0] === 'speciesId' ? 'species' : String(path[0]), t)))
      setErrors([...fields].map((field) => field + ' · ' + t.invalidField))
      return
    }
    setErrors([])
    setBusy(true)
    try {
      if (image) {
        if (!animalPhotoSchema.safeParse({ animalId: id, image }).success) {
          setErrors([t.invalidPhoto])
          return
        }
        const url = URL.createObjectURL(image)
        try {
          const decoded = new Image()
          decoded.src = url
          await decoded.decode()
        } catch {
          setErrors([t.invalidPhoto])
          return
        } finally {
          URL.revokeObjectURL(url)
        }
      }
      const saved = await repositories.animals.save(parsed.data, image ? image.slice(0, image.size, image.type) : image)
      navigate('/animals/' + saved.id, { replace: true })
    } catch (error) {
      setErrors([error instanceof AnimalTagConflict ? t.activeTag : strings[language].error])
    } finally {
      setBusy(false)
    }
  }

  const text = (key: 'earTag' | 'name' | 'breed' | 'birthDate' | 'acquisitionDate' | 'source', type = 'text') => (
    <Field label={t[key]}>
      <input className="registry-control" name={key} type={type} defaultValue={animal?.[key]} required={key === 'earTag'} />
    </Field>
  )

  return (
    <>
      <h1 className="mt-2">{heading}</h1>
      <form className="panel mt-6 max-w-3xl" onSubmit={submit}>
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2" aria-label={t.identification}>
          {text('earTag')}
          {text('name')}
          <Field label={t.species}>
            <select className="registry-control" name="speciesId" required
              defaultValue={animal?.speciesId ?? species.find((item) => item.code === 'goat' && item.active)?.id ?? ''}>
              <option value="">{t.select}</option>
              {species.filter(({ id, active }) => active || id === animal?.speciesId)
                .map((item) => <option key={item.id} value={item.id}>{speciesName(item, language)}</option>)}
            </select>
          </Field>
          {text('breed')}
          <Field label={t.sex}>
            <select className="registry-control" name="sex" defaultValue={animal?.sex ?? ''} required>
              <option value="">{t.select}</option>
              {animalSexes.map((sex) => <option key={sex} value={sex}>{t[sex]}</option>)}
            </select>
          </Field>
          <Field label={t.status}>
            <select className="registry-control" name="status" defaultValue={animal?.status ?? 'active'} required>
              {animalStatuses.map((status) => <option key={status} value={status}>{t[status]}</option>)}
            </select>
          </Field>
          {text('birthDate', 'date')}
          {text('acquisitionDate', 'date')}
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input name="approximate" type="checkbox" defaultChecked={animal?.birthDateApproximate} />{t.approximate}
          </label>
          {text('source')}
          {groups.length > 0 && <Field label={t.group}>
            <select className="registry-control" name="groupId" defaultValue={animal?.groupId ?? ''}>
              <option value="">{t.select}</option>
              {groups.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </Field>}
          <div className="sm:col-span-2">
            <Field label={t.notes}>
              <textarea className="registry-control" name="notes" rows={4} defaultValue={animal?.notes} />
            </Field>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <Field label={t.photo}>
              <input className="registry-control" type="file" accept={photoTypes.join(',')} ref={fileInput}
                aria-describedby="photo-hint" onChange={(event) => setImage(event.currentTarget.files?.[0] ?? (image === null ? null : undefined))} />
            </Field>
            <p id="photo-hint" className="mt-1 text-sm text-stone-700">{t.photoHint}</p>
            {preview && <div className="mt-3 flex flex-wrap items-start gap-3">
              <AnimalPhoto image={preview} className="max-h-32 max-w-full rounded-md" alt={t.photo} />
              <button type="button" className="registry-action secondary" onClick={() => {
                setImage(null)
                if (fileInput.current) fileInput.current.value = ''
              }}>{t.removePhoto}</button>
            </div>}
          </div>
        </fieldset>
        {errors.length > 0 && <ul role="alert" className="registry-error mt-4">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="registry-action" disabled={busy}>{busy ? strings[language].saving : t.save}</button>
          <Link className="registry-action secondary" to={cancelTo}>{t.cancel}</Link>
        </div>
      </form>
    </>
  )
}
