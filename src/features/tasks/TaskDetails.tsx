import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { taskStrings } from '../../i18n/tasks'
import { strings } from '../../i18n/strings'
import { useLocalQuery } from '../animals/shared'
import { animalLabel } from '../health/HealthTimeline'
import { displayDate, displayTimestamp } from '../health/entry'
import { TaskForm } from './TaskForm'
import { TaskState, taskError, useToday } from './shared'

async function readTask(id: string) {
  const task = await repositories.tasks.get(id)
  if (!task) return null
  const [animal, linked, source] = await Promise.all([
    task.animalId ? repositories.animals.get(task.animalId) : undefined,
    task.healthEventId ? repositories.health.latest(task.healthEventId) : undefined,
    task.healthEventId ? repositories.health.reminderSource(task.healthEventId) : undefined,
  ])
  return { task, animal, linked, source }
}

export function TaskDetails({ language, editing = false }: { language: Language; editing?: boolean }) {
  const { id = '' } = useParams()
  const query = useCallback(() => readTask(id), [id])
  const data = useLocalQuery(query)
  const today = useToday()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const t = taskStrings[language]
  if (!data) return <p role="status">{strings[language].loading}</p>
  if (data.error) return <p role="alert">{strings[language].error}</p>
  if (!data.data) return <p role="alert">{t.missing}</p>
  const { task, animal, linked, source } = data.data
  if (editing && task.status === 'pending') return <TaskForm key={id} language={language} task={task} />

  async function finish(status: 'completed' | 'cancelled') {
    setBusy(true)
    setError('')
    try {
      await repositories.tasks.finish(id, status)
      setConfirm(false)
    } catch (error) {
      setError(taskError(error, language))
    } finally {
      setBusy(false)
    }
  }

  return <div className="registry">
    <Link className="registry-link inline-flex min-h-11 items-center" to="/tasks">{t.calendar}</Link>
    <h1 className="mt-2 break-words">{task.title}</h1>
    <section className="panel mt-6 max-w-3xl">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt>{t.dueDate}</dt><dd className="font-semibold"><time dateTime={task.dueDate}>{displayDate(task.dueDate, language)}</time></dd></div>
        <div><dt>{animalStrings[language].status}</dt><dd><TaskState task={task} today={today} language={language} /></dd></div>
        <div><dt>{t.type}</dt><dd>{t[task.type]}</dd></div>
        {animal && <div className="min-w-0 break-words"><dt>{animalStrings[language].registry}</dt>
          <dd><Link className="registry-link" to={'/animals/' + animal.id}>{animalLabel(animal)}</Link> · {animalStrings[language][animal.status]}</dd>
        </div>}
        {task.description && <div className="min-w-0 sm:col-span-2"><dt>{t.description}</dt><dd className="whitespace-pre-wrap break-words">{task.description}</dd></div>}
        {linked && <div className="sm:col-span-2"><dt>{t.event}</dt>
          <dd><Link className="registry-link" to={'/veterinary/events/' + linked.event.id}>{t.latestEvent}</Link></dd>
          <dd className="text-sm">{source ? t.currentSourceDate + ' · ' + displayDate(source.dueDate, language) : t.noSourceDate}</dd>
        </div>}
        <div className="text-sm"><dt>{t.created}</dt><dd>{displayTimestamp(task.createdAt, language)}</dd></div>
        <div className="text-sm"><dt>{t.updated}</dt><dd>{displayTimestamp(task.updatedAt, language)}</dd></div>
        {task.completedAt && <div className="text-sm"><dt>{t.completedAt}</dt><dd>{displayTimestamp(task.completedAt, language)}</dd></div>}
      </dl>
      {task.status === 'pending' && <div className="mt-5 flex flex-wrap gap-2">
        <button className="registry-action" disabled={busy} onClick={() => void finish('completed')}>{t.complete}</button>
        <Link className="registry-action secondary" to={'/tasks/' + id + '/edit'}>{t.edit} / {t.reschedule}</Link>
        {confirm ? <>
          <button className="registry-action danger" disabled={busy} onClick={() => void finish('cancelled')}>{t.confirmCancel}</button>
          <button className="registry-action secondary" disabled={busy} onClick={() => setConfirm(false)}>{animalStrings[language].cancel}</button>
        </> : <button className="registry-action secondary" disabled={busy} onClick={() => setConfirm(true)}>{t.cancelTask}</button>}
      </div>}
      {error && <p className="registry-error mt-3" role="alert">{error}</p>}
    </section>
  </div>
}
