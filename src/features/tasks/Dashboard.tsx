import {getAccess} from '../auth/access'
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

  const readOnly=getAccess()?.role==='VETERINARIAN'
  const due=data ? data.clinicalTasks.filter(row=>row.type==='vaccination').length+
    data.clinicalDates.filter(row=>row.type==='vaccination').length : 0
  const words=language==='sq'
    ? {title:'Si është ferma sot?',intro:'Kafshët dhe kujdesi që kërkojnë vëmendjen tënde.',add:'Shto kafshë',vaccine:'Regjistro vaksinim',check:'Shto kontroll',soon:'Vaksinime në 30 ditët e ardhshme',urgent:'Kërkojnë vëmendje',all:'Shih kalendarin',herd:'Tufa jote'}
    : {title:'How is the farm today?',intro:'Your animals and the care that needs your attention.',add:'Add animal',vaccine:'Record vaccination',check:'Add checkup',soon:'Vaccinations in the next 30 days',urgent:'Needs attention',all:'View calendar',herd:'Your herd'}
  return (
    <div className="registry dashboard">
      <div className="dashboard-heading">
        <h1>{words.title}</h1>
        <p className="page-description">{words.intro}</p>
        {!readOnly&&<div className="dashboard-actions">
          <Link to="/animals/new" className="registry-action">{words.add}</Link>
          <Link to="/veterinary/new?kind=vaccination" className="registry-action secondary">{words.vaccine}</Link>
          <Link to="/veterinary/new?kind=checkup" className="registry-action secondary">{words.check}</Link>
        </div>}
      </div>
      {!result&&<p role="status">{app.loading}</p>}
      {result?.error&&<p role="alert" className="registry-error">{app.error}</p>}
      {data&&<>
        <div className="stat-strip">
          <section className="stat-cell" aria-label={app.active}><dl><dt>{app.active}</dt><dd>{data.active}</dd></dl></section>
          <Link className="stat-cell" to="/tasks?type=vaccination"><dl><dt>{words.soon}</dt><dd>{due}</dd></dl></Link>
          <Link className="stat-cell urgent" to={calendar('',shiftDay(today,-1))}><dl><dt>{t.overdue}</dt><dd>{data.taskCounts.overdue}</dd></dl></Link>
        </div>
        <div className="dashboard-grid">
          <section className="panel" aria-labelledby="dashboard-tasks">
            <div className="section-heading"><h2 id="dashboard-tasks">{words.urgent}</h2><div className="flex gap-4"><Link className="subtle-link" to="/tasks">{words.all}</Link>{!readOnly&&<Link className="subtle-link" to="/tasks/new">{t.add}</Link>}</div></div>
            <ul className="grid grid-cols-2 gap-3">
              {([
                [t.overdue,data.taskCounts.overdue,calendar('',shiftDay(today,-1))],
                [t.today,data.taskCounts.today,calendar(today,today)],
                [t.week,data.taskCounts.week,calendar(tomorrow,shiftDay(today,7))],
                [t.month,data.taskCounts.month,calendar(tomorrow,shiftDay(today,30))],
              ] as const).map(([label,count,url])=><li key={label}>
                <Link to={url} className="flex min-h-16 items-center justify-between rounded-lg bg-stone-50 px-4 py-3 text-sm">
                  <span>{label}</span><strong className="text-xl tabular-nums text-pine">{count}</strong>
                </Link></li>)}
            </ul>
          </section>
          <ClinicalDates data={data} type="vaccination" today={today} language={language}/>
          <section className="panel">
            <div className="section-heading"><h2>{t.recent}</h2><Link to="/veterinary" className="subtle-link">{healthStrings[language].veterinary}</Link></div>
            {data.records.length?<ul className="activity-list divide-y divide-stone-200">
              {data.records.map(event=>{
                const animal=data.animals.get(event.animalId)
                return <li key={event.id}><Link className="registry-link" to={'/veterinary/events/'+event.id}>
                  {healthStrings[language][event.kind]}{animal?' · '+animalLabel(animal):''}</Link>
                  <p>{displayEventDate(event,language)}</p></li>
              })}
            </ul>:<p className="mt-3 text-sm text-stone-600">{healthStrings[language].empty}</p>}
          </section>
          <ClinicalDates data={data} type="checkup" today={today} language={language}/>
        </div>
        <section className="panel mt-5">
          <div className="section-heading"><h2>{words.herd}</h2><Link to="/animals" className="subtle-link">{language==='sq'?'Shih kafshët':'View animals'}</Link></div>
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {([[t.total,data.total],[t.archivedAnimals,data.archived]] as const).map(([label,count])=>
              <section key={label} aria-label={label}><h3 className="text-sm text-stone-600">{label}</h3><p className="text-xl font-semibold tabular-nums">{count}</p></section>)}
            {data.speciesCounts.map(({species,count})=><div key={species.id}><p className="text-sm text-stone-600">{speciesName(species,language)}</p><p className="text-xl font-semibold tabular-nums">{count}</p></div>)}
          </div>
          {!data.total&&<p className="mt-4 text-sm">{app.empty}</p>}
        </section>
      </>}
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
