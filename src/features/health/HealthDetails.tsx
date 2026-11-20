import {getAccess} from '../auth/access'
import { useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { healthStrings } from '../../i18n/health'
import { strings } from '../../i18n/strings'
import { useLocalQuery } from '../animals/shared'
import { displayTimestamp, recordFields } from './entry'
import { HealthForm } from './HealthForm'
import { HealthValues } from './HealthFields'
import { animalLabel } from './HealthTimeline'
import { EventReminder } from '../tasks/EventReminder'

async function readRecord(id: string) {
  const record = await repositories.health.get(id)
  if (!record) return null
  const [animal, amendment] = await Promise.all([
    repositories.animals.get(record.event.animalId), repositories.health.amendmentOf(id),
  ])
  return { record, animal, amendment }
}

export function HealthDetails({ language, editing = false }: { language: Language; editing?: boolean }) {
  const { id = '' } = useParams()
  const query = useCallback(() => readRecord(id), [id])
  const result = useLocalQuery(query)
  const t = healthStrings[language]
  if (!result) return <p role="status">{strings[language].loading}</p>
  if (result.error) return <p role="alert">{strings[language].error}</p>
  if (!result.data) return <p role="alert">{t.missing}</p>
  const { record, animal, amendment } = result.data
  const { event } = record
  if (editing && animal && !amendment) return <HealthForm key={id} language={language} animal={animal} original={record} />
  return (
    <div className="registry">
      <Link to="/veterinary" className="registry-link inline-flex min-h-11 items-center">{t.back}</Link>
      <div className="registry-heading mt-2">
        <h1>{t[event.kind]}{event.amendsId ? ' · ' + t.amendment : ''}</h1>
        {getAccess()?.role!=='VETERINARIAN' && animal && !amendment && <Link to={'/veterinary/events/' + id + '/amend'} className="registry-action secondary">{t.amend}</Link>}
      </div>
      {animal && <Link className="registry-link mt-2 inline-block break-words" to={'/animals/' + animal.id}>{animalLabel(animal)}</Link>}
      <section className="panel mt-6 max-w-3xl">
        <h2>{t.details}</h2>
        <div className="mt-4"><HealthValues language={language} kind={event.kind} values={recordFields(record)} /></div>
        {(event.amendsId || amendment) && <div className="mt-5 grid gap-2 border-t border-stone-200 pt-4">
          {event.amendsId && <>
            <Link className="registry-link" to={'/veterinary/events/' + event.amendsId}>{t.original}</Link>
            <p className="whitespace-pre-wrap break-words"><strong>{t.amendmentReason}</strong> · {event.amendmentReason}</p>
          </>}
          {amendment && <Link className="registry-link" to={'/veterinary/events/' + amendment.id}>{t.replacement}</Link>}
        </div>}
        <dl className="mt-5 grid gap-3 border-t border-stone-200 pt-4 text-sm">
          <div><dt>{t.created}</dt><dd>{displayTimestamp(event.createdAt, language)}</dd></div>
          <div><dt>{t.recordId}</dt><dd className="break-all">{event.id}</dd></div>
          {event.batchId && <div><dt>{t.batchId}</dt><dd className="break-all">{event.batchId}</dd></div>}
        </dl>
      </section>
      {getAccess()?.role!=='VETERINARIAN'&&<EventReminder key={id} eventId={id} language={language} />}
    </div>
  )
}
