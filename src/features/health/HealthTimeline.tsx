import {getAccess} from '../auth/access'
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { Animal, HealthEvent, Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { healthStrings } from '../../i18n/health'
import { strings } from '../../i18n/strings'
import { useLocalQuery } from '../animals/shared'
import { displayEventDate } from './entry'

export function animalLabel(animal: Animal) {
  return animal.name ? animal.earTag + ' · ' + animal.name : animal.earTag
}

function sortEvents(events: HealthEvent[]) {
  return [...events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
}

function EventList({ events, animals, language }: { events: HealthEvent[]; animals?: Animal[]; language: Language }) {
  const t = healthStrings[language]
  if (!events.length) return <p className="mt-3">{t.empty}</p>
  const amended = new Set(events.map(({ amendsId }) => amendsId))
  const labels = new Map(animals?.map((animal) => [animal.id, animalLabel(animal)]))
  return (
    <ol className="medical-timeline mt-3 divide-y divide-stone-200">
      {sortEvents(events).map((event) => (
        <li key={event.id}>
          <Link to={'/veterinary/events/' + event.id}
            className="grid min-h-12 gap-1 rounded px-2 py-3 hover:bg-green-50 sm:grid-cols-[minmax(0,1fr)_auto]">
            <span className="min-w-0 break-words">
              <span className="font-semibold text-pine">{t[event.kind]}</span>
              {labels.has(event.animalId) && <span className="text-sm"> · {labels.get(event.animalId)}</span>}
              {event.amendsId && <span className="text-sm"> · {t.amendment}</span>}
              {amended.has(event.id) && <span className="text-sm"> · {t.superseded}</span>}
            </span>
            <time dateTime={event.occurredAt} className="text-sm text-stone-700">{displayEventDate(event, language)}</time>
          </Link>
        </li>
      ))}
    </ol>
  )
}

export function HealthTimeline({ animalId, language }: { animalId: string; language: Language }) {
  const t = healthStrings[language]
  const query = useCallback(() => repositories.health.list(animalId), [animalId])
  const result = useLocalQuery(query)
  return (
    <section className="panel mt-6" aria-labelledby="health-timeline">
      <div className="registry-heading">
        <h2 id="health-timeline">{t.timeline}</h2>
        {getAccess()?.role!=='VETERINARIAN'&&<Link to={'/veterinary/new?animal=' + animalId} className="registry-action">{t.add}</Link>}
      </div>
      {result?.error && <p role="alert" className="registry-error mt-3">{strings[language].error}</p>}
      {!result && <p role="status" className="mt-3">{strings[language].loading}</p>}
      {result?.data && <EventList events={result.data} language={language} />}
    </section>
  )
}

async function readRecent() {
  const [events, animals] = await Promise.all([repositories.health.recent(), repositories.animals.list()])
  return { events, animals }
}

export function HealthOverview({ language }: { language: Language }) {
  const t = healthStrings[language]
  const result = useLocalQuery(readRecent)
  return (
    <div className="registry">
      <div className="registry-heading">
        <h1>{t.veterinary}</h1>
        {getAccess()?.role!=='VETERINARIAN'&&<div className="flex flex-wrap gap-2">
          <Link to="batch" className="registry-action secondary">{t.batch}</Link>
          <Link to="new" className="registry-action">{t.add}</Link>
        </div>}
      </div>
      <section className="panel mt-6">
        <h2>{t.recent}</h2>
        {result?.error && <p role="alert" className="registry-error mt-3">{strings[language].error}</p>}
        {!result && <p role="status" className="mt-3">{strings[language].loading}</p>}
        {result?.data && <EventList {...result.data} language={language} />}
      </section>
    </div>
  )
}
