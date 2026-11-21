import {getAccess} from '../auth/access'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Language } from '../../db/models'
import { taskDatesSchema, taskFilterSchema, taskStatuses, taskTypes, type TaskFilter } from '../../db/taskModels'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { taskStrings } from '../../i18n/tasks'
import { strings } from '../../i18n/strings'
import { groupByDueDate, monthDays, shiftDay, shiftMonth, weekday } from '../../lib/calendar'
import { Field, useLocalQuery } from '../animals/shared'
import { animalLabel } from '../health/HealthTimeline'
import { displayDate } from '../health/entry'
import { TaskList, useToday } from './shared'

const dateValue = taskDatesSchema.shape.from

export function CalendarPage({ language }: { language: Language }) {
  const t = taskStrings[language]
  const labels = animalStrings[language]
  const today = useToday()
  const [params] = useSearchParams()
  const listView=params.get('view')==='list'
  const [filters, setFilters] = useState<TaskFilter>(() => {
    const shape = taskFilterSchema.shape
    return {
      type: shape.type.safeParse(params.get('type') || undefined).data,
      animalId: shape.animalId.safeParse(params.get('animalId') || undefined).data,
      status: shape.status.safeParse(params.get('status') || undefined).data,
      from: dateValue.safeParse(params.get('from') || undefined).data,
      to: dateValue.safeParse(params.get('to') || undefined).data,
    }
  })
  const [day, setDay] = useState(() => {
    if (filters.from && filters.from > today) return filters.from
    if (filters.to && filters.to < today) return filters.to
    return today
  })
  const month = day.slice(0, 7) + '-01'
  const days = monthDays(month)
  const query = useCallback(async () => {
    const intersect = (from?: string, to?: string) => ({
      ...filters,
      from: filters.from && (!from || filters.from > from) ? filters.from : from,
      to: filters.to && (!to || filters.to < to) ? filters.to : to,
    })
    const read = (from?: string, to?: string, pending = false) => {
      const range = intersect(from, to)
      if ((range.from && range.to && range.from > range.to) ||
          (pending && filters.status && filters.status !== 'pending')) return Promise.resolve([])
      return repositories.tasks.range({ ...range, status: pending ? 'pending' : filters.status })
    }
    const [monthTasks, upcoming, overdue, list] = await Promise.all([
      read(month, shiftDay(shiftMonth(month, 1), -1)),
      read(today, shiftDay(today, 30), true), read(undefined, shiftDay(today, -1), true),
      listView?read():Promise.resolve([]),
    ])
    return { groups: groupByDueDate(monthTasks), upcoming, overdue, list }
  }, [filters, month, today,listView])
  const result = useLocalQuery(query)
  const data = result?.data
  const animalResult = useLocalQuery(repositories.animals.list)
  const animals = useMemo(() => new Map(animalResult?.data?.map((animal) => [animal.id, animal])), [animalResult])
  const clinicalQuery=useCallback(async()=>{
    if(filters.status&&filters.status!=='pending')return []
    const sources=await repositories.health.upcomingSources(filters.from,filters.to??shiftDay(today,30))
    return (await Promise.all(sources.map(async source=>
      (!filters.type||filters.type===source.type)&&(!filters.animalId||filters.animalId===source.event.animalId)&&!await repositories.tasks.reminderFor(source.rootId,source.type)?source:undefined,
    ))).flatMap(source=>source?[source]:[])
  },[filters,today])
  const clinical=useLocalQuery(clinicalQuery)

  function change(key: keyof TaskFilter, value: string) {
    const parsed = taskFilterSchema.shape[key].safeParse(value || undefined)
    if (parsed.success) setFilters((current) => ({ ...current, [key]: parsed.data }))
  }

  const weekdays = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' })
  const monthLabel = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <div className="registry">
      <div className="registry-heading">
        <h1>{listView?(language==='sq'?'Detyrat':'Tasks'):t.calendar}</h1>
        {getAccess()?.role!=='VETERINARIAN'&&<Link to={'/tasks/new?date=' + day} className="registry-action">{t.add}</Link>}
      </div>
      <section className="panel mt-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t.type}><select className="registry-control" value={filters.type ?? ''} onChange={(e) => change('type', e.target.value)}>
            <option value="">{labels.all}</option>
            {taskTypes.map((type) => <option key={type} value={type}>{t[type]}</option>)}
          </select></Field>
          <Field label={labels.status}><select className="registry-control" value={filters.status ?? ''} onChange={(e) => change('status', e.target.value)}>
            <option value="">{labels.all}</option>
            {taskStatuses.map((status) => <option key={status} value={status}>{t[status]}</option>)}
          </select></Field>
          <Field label={labels.registry}><select className="registry-control" value={filters.animalId ?? ''} onChange={(e) => change('animalId', e.target.value)}>
            <option value="">{labels.all}</option>
            {[...(animals.values())].sort((a, b) => a.earTag.localeCompare(b.earTag, language, { numeric: true }))
              .map((animal) => <option key={animal.id} value={animal.id}>{animalLabel(animal)}</option>)}
          </select></Field>
          <Field label={t.from}><input className="registry-control" type="date" value={filters.from ?? ''} onChange={(e) => change('from', e.target.value)} /></Field>
          <Field label={t.to}><input className="registry-control" type="date" value={filters.to ?? ''} onChange={(e) => change('to', e.target.value)} /></Field>
          {Object.values(filters).some(Boolean) && <div className="flex items-end"><button className="registry-action secondary" onClick={() => setFilters({})}>{labels.clear}</button></div>}
        </div>
        {filters.from && filters.to && filters.from > filters.to && <p role="alert" className="registry-error mt-3">{t.rangeError}</p>}
      </section>
      {!result && <p className="mt-3" role="status">{strings[language].loading}</p>}
      {(result?.error || animalResult?.error) && <p className="registry-error mt-3" role="alert">{strings[language].error}</p>}
      {listView&&data&&<section className="panel mt-4"><TaskList language={language} today={today} animals={animals} tasks={data.list}/></section>}
      {!listView&&<section className="panel mt-4" aria-labelledby="calendar-month">
        <div className="registry-heading">
          <h2 id="calendar-month" className="capitalize">{monthLabel.format(new Date(month + 'T00:00:00Z'))}</h2>
          <div className="flex flex-wrap gap-2">
            <button className="registry-action secondary" onClick={() => setDay(shiftMonth(month, -1))}>{t.previous}</button>
            <button className="registry-action secondary" onClick={() => setDay(today)}>{t.today}</button>
            <button className="registry-action secondary" onClick={() => setDay(shiftMonth(month, 1))}>{t.next}</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, index) => (
            <span className="truncate text-center text-xs font-semibold text-stone-700 sm:text-sm" key={index}>
              {weekdays.format(new Date(Date.UTC(2024, 0, index + 1)))}
            </span>
          ))}
          {Array.from({ length: weekday(month) }, (_, index) => <span aria-hidden="true" key={'empty-' + index} />)}
          {days.map((date) => {
            const count = data?.groups.get(date)?.length ?? 0
            return <button key={date} type="button" aria-pressed={day === date} aria-current={today === date ? 'date' : undefined}
              aria-label={displayDate(date, language) + (count ? ' · ' + t.task + ' ' + count : '')}
              className={`registry-action min-w-0 flex-col !px-0 ${day === date ? '' : 'secondary'}`}
              onClick={() => setDay(date)}>
              <span>{Number(date.slice(-2))}</span>{count > 0 && <span className="text-xs tabular-nums">{count}</span>}
            </button>
          })}
        </div>
      </section>}
      {clinical?.data&&clinical.data.length>0&&<section className="panel mt-4" aria-labelledby="recorded-clinical-dates">
        <h2 id="recorded-clinical-dates">{language==='sq'?'Datat veterinare të regjistruara':'Recorded veterinary dates'}</h2>
        <p className="mt-2 text-sm">{t.recorded}</p>
        <ul className="mt-3 divide-y divide-stone-200">{clinical.data.map(source=><li key={source.rootId} className="py-3">
          <Link className="registry-link" to={'/veterinary/events/'+source.event.id}>{t[source.type]}{animals.get(source.event.animalId)?' · '+animalLabel(animals.get(source.event.animalId)!):''}</Link>
          <p className={'mt-1 text-sm '+(source.dueDate<today?'registry-error':'')}><time dateTime={source.dueDate}>{displayDate(source.dueDate,language)}</time>{source.dueDate<today?' · '+t.overdue:''}</p>
        </li>)}</ul>
      </section>}
      {data && !listView && <>
        <section className="panel mt-4" aria-labelledby="calendar-agenda">
          <div className="registry-heading">
            <h2 id="calendar-agenda">{t.agenda}</h2>
            <Field label={t.chooseDay}><input className="registry-control" type="date" value={day}
              onChange={(e) => { const date = dateValue.safeParse(e.target.value); if (date.data) setDay(date.data) }} /></Field>
          </div>
          <TaskList language={language} today={today} animals={animals} tasks={data.groups.get(day) ?? []} />
        </section>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <section className="panel min-w-0" aria-labelledby="calendar-overdue"><h2 id="calendar-overdue">{t.overdue}</h2>
            <TaskList language={language} today={today} animals={animals} tasks={data.overdue} />
          </section>
          <section className="panel min-w-0" aria-labelledby="calendar-upcoming"><h2 id="calendar-upcoming">{t.upcoming}</h2>
            <p className="mt-1 text-sm">{t.today} · {t.month}</p>
            <TaskList language={language} today={today} animals={animals} tasks={data.upcoming} />
          </section>
        </div>
      </>}
    </div>
  )
}
