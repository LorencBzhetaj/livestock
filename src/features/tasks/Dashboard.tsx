import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { taskStrings } from '../../i18n/tasks'
import { healthStrings } from '../../i18n/health'
import { strings } from '../../i18n/strings'
import { shiftDay } from '../../lib/calendar'
import { speciesName, useLocalQuery } from '../animals/shared'
import { animalLabel } from '../health/HealthTimeline'
import { displayDate, displayEventDate } from '../health/entry'
import { useToday } from './shared'

type DashboardData = Awaited<ReturnType<typeof repositories.dashboard>>

export default function Dashboard({ language }: { language: Language }) {
  const t = taskStrings[language]
  const app = strings[language]
  const today = useToday()
  const query = useCallback(() => repositories.dashboard(today), [today])
  const result = useLocalQuery(query)
  const data = result?.data
  const tomorrow = shiftDay(today, 1)
  const calendar = (from: string, to: string) => '/tasks?status=pending&from=' + from + '&to=' + to

  return (
    <div className="registry">
      <div className="registry-heading">
        <h1>{app.intro}</h1>
        <Link to="/tasks" className="registry-action secondary">{t.calendar}</Link>
      </div>
      {!result && <p role="status" className="mt-5">{app.loading}</p>}
      {result?.error && <p role="alert" className="registry-error mt-5">{app.error}</p>}
      {data && <>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {([[t.total, data.total], [app.active, data.active], [t.archivedAnimals, data.archived]] as const).map(([label, count], index) => (
            <section className="panel" key={label} aria-labelledby={'animal-count-' + index}>
              <h2 id={'animal-count-' + index}>{label}</h2>
              <p className="mt-2 text-4xl font-semibold tabular-nums text-pine">{count}</p>
            </section>
          ))}
        </div>
        {!data.total && <p className="mt-3">{app.empty}</p>}
        <section className="panel mt-4">
          <h2>{t.bySpecies}</h2>
          {data.speciesCounts.length ? <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.speciesCounts.map(({ species, count }) => (
              <div key={species.id} className="min-w-0 break-words">
                <dt>{speciesName(species, language)}</dt><dd className="font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl> : <p className="mt-2">{t.none}</p>}
        </section>
        <section className="panel mt-4" aria-labelledby="dashboard-tasks">
          <div className="registry-heading"><h2 id="dashboard-tasks">{t.upcoming}</h2>
            <Link className="registry-action" to="/tasks/new">{t.add}</Link>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              [t.overdue, data.taskCounts.overdue, calendar('', shiftDay(today, -1))],
              [t.today, data.taskCounts.today, calendar(today, today)],
              [t.week, data.taskCounts.week, calendar(tomorrow, shiftDay(today, 7))],
              [t.month, data.taskCounts.month, calendar(tomorrow, shiftDay(today, 30))],
            ] as const).map(([label, count, url]) => (
              <li key={label} className="min-w-0">
                <Link to={url} className="block min-h-20 rounded-md border border-stone-300 px-3 py-2 hover:bg-green-50">
                  <span className="text-sm">{label}</span>
                  <span className="block text-2xl font-semibold tabular-nums text-pine">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ClinicalDates data={data} type="vaccination" today={today} language={language} />
          <ClinicalDates data={data} type="checkup" today={today} language={language} />
        </div>
        <section className="panel mt-4">
          <h2>{t.recent}</h2>
          {data.records.length ? <ul className="mt-2 divide-y divide-stone-200">
            {data.records.map((event) => {
              const animal = data.animals.get(event.animalId)
              return <li key={event.id} className="py-2">
                <Link className="registry-link inline-flex min-h-11 items-center break-words" to={'/veterinary/events/' + event.id}>
                  {healthStrings[language][event.kind]}{animal ? ' · ' + animalLabel(animal) : ''}
                </Link>
                <p className="text-sm">{displayEventDate(event, language)}</p>
              </li>
            })}
          </ul> : <p className="mt-2">{healthStrings[language].empty}</p>}
        </section>
      </>}
      <p className="mt-6 max-w-xl">{app.localHelp}</p>
    </div>
  )
}

function ClinicalDates({ data, type, today, language }: {
  data: DashboardData; type: 'vaccination' | 'checkup'; today: string; language: Language
}) {
  const t = taskStrings[language]
  const entries = [
    ...data.clinicalTasks.filter((task) => task.type === type).map((task) => ({
      id: task.id, dueDate: task.dueDate, label: task.title, animalId: task.animalId,
      url: '/tasks/' + task.id, status: task.dueDate === today ? t.today : t.pending,
    })),
    ...data.clinicalDates.filter((source) => source.type === type).map((source) => ({
      id: source.event.id, dueDate: source.dueDate, label: t[type], animalId: source.event.animalId,
      url: '/veterinary/events/' + source.event.id, status: t.recorded,
    })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return <section className="panel min-w-0">
    <h2>{type === 'vaccination' ? t.upcomingVaccinations : t.upcomingCheckups}</h2>
    {entries.length ? <ul className="mt-2 max-h-80 divide-y divide-stone-200 overflow-y-auto">
      {entries.map((entry) => {
        const animal = entry.animalId ? data.animals.get(entry.animalId) : undefined
        return <li key={entry.id} className="break-words py-2">
          <Link className="registry-link inline-flex min-h-11 items-center" to={entry.url}>
            {entry.label}{animal ? ' · ' + animalLabel(animal) : ''}
          </Link>
          <p className="text-sm"><time dateTime={entry.dueDate}>{displayDate(entry.dueDate, language)}</time> · {entry.status}</p>
        </li>
      })}
    </ul> : <p className="mt-2">{t.noDates}</p>}
  </section>
}
