import { useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimalTagConflict } from '../../db/animalTags'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { strings } from '../../i18n/strings'
import { columns, downloadTemplate, maxCsvBytes, previewCsv } from './csv'
import { BackToAnimals, Field, fieldLabel, speciesName, useLocalQuery } from './shared'

async function readImportData() {
  const [species, animals] = await Promise.all([repositories.species.list(), repositories.animals.list()])
  return { species, tags: animals.map(({ earTag }) => earTag) }
}

export function AnimalImport({ language }: { language: Language }) {
  const t = animalStrings[language]
  const navigate = useNavigate()
  const result = useLocalQuery(readImportData)
  const [source, setSource] = useState<{ name: string; text: string }>()
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<'file' | 'save' | 'conflict'>()
  const preview = useMemo(() => {
    if (source && result?.data) return previewCsv(source.text, result.data.species, result.data.tags)
  }, [source, result])
  const valid = preview?.rows.filter((row) => row.animal && !row.issues.length).length ?? 0
  const ready = valid > 0 && valid === preview?.rows.length

  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setSource(undefined)
    setFailure(undefined)
    setReading(true)
    try {
      if (file.size > maxCsvBytes) throw new Error('CSV size')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      setSource({ name: file.name, text })
    } catch {
      setFailure('file')
    } finally {
      setReading(false)
    }
  }

  async function commit() {
    if (!ready || !preview || saving) return
    setSaving(true)
    setFailure(undefined)
    try {
      await repositories.animals.import(preview.rows.flatMap(({ animal }) => animal ? [animal] : []))
      navigate('/animals', { replace: true, state: { imported: valid } })
    } catch (error) {
      setFailure(error instanceof AnimalTagConflict ? 'conflict' : 'save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="registry">
      <BackToAnimals language={language} />
      <h1 className="mt-2">{t.csv}</h1>
      <div className="panel mt-6">
        <p>{t.csvHelp}</p>
        <p className="mt-2 break-words text-sm text-stone-700">{t.csvValues}</p>
        <div className="mt-4">
          <button className="registry-action secondary" onClick={downloadTemplate}>{t.template}</button>
        </div>
        <div className="mt-5 max-w-md">
          <Field label={t.file}>
            <input className="registry-control" type="file" accept=".csv,text/csv"
              disabled={reading || saving || !result?.data} onChange={(event) => void read(event)} />
          </Field>
        </div>
        {source && <p className="mt-2 break-all text-sm text-stone-700">{source.name}</p>}
        {(reading || !result) && <p role="status" className="mt-2">{strings[language].loading}</p>}
        {(result?.error || failure) && <p role="alert" className="registry-error mt-3">
          {failure === 'file' ? t.fileError : failure === 'conflict' ? t.csvChanged : strings[language].error}
        </p>}
        {preview?.fileIssue && <p role="alert" className="registry-error mt-3">{t[preview.fileIssue]}</p>}
      </div>
      {preview && preview.rows.length > 0 && (
        <section className="mt-7" aria-labelledby="preview-heading">
          <div className="registry-heading">
            <div>
              <h2 id="preview-heading">{t.preview}</h2>
              <p className="mt-1 text-sm tabular-nums" role="status">{t.ready} · {valid} / {preview.rows.length}</p>
            </div>
            <button className="registry-action" disabled={!ready || saving} onClick={() => void commit()}>
              {saving ? strings[language].saving : t.confirmImport}
            </button>
          </div>
          {!ready && <p className="registry-error mt-3">{t.fixFile}</p>}
          <ol className="mt-4 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
            {preview.rows.map(({ line, values, issues, animal }) => {
              const species = result?.data?.species.find(({ id }) => id === animal?.speciesId)
              const displayed = animal ? {
                ...values, species: species && speciesName(species, language), sex: t[animal.sex], status: t[animal.status],
              } : values
              return (
                <li key={line} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="min-w-0 break-words">
                    <p>
                      <span className="mr-2 text-sm text-stone-700">{t.line} {line}</span>
                      <strong className="text-pine">{animal?.earTag || values.earTag || '—'}</strong>
                      {values.name && <span className="ml-2">{values.name}</span>}
                    </p>
                    <dl className="mt-1 flex flex-wrap gap-x-3 text-sm">
                      {columns.filter((key) => key !== 'earTag' && key !== 'name' && displayed[key]).map((key) => (
                        <div key={key} className="min-w-0 whitespace-pre-wrap">
                          <dt className="inline font-medium">{fieldLabel(key, t)} </dt>
                          <dd className="inline text-stone-700">{displayed[key]}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  {issues.length ? <ul className="registry-error break-words text-sm">
                    {issues.map((issue, index) => <li key={index}>
                      {issue.key === 'invalidField' ? fieldLabel(issue.field, t) + ' · ' + t.invalidField : t[issue.key]}
                    </li>)}
                  </ul> : <p className="text-sm text-pine">{t.ready}</p>}
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
