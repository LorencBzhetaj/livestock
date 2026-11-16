import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Language } from '../../db/models'
import { taskDatesSchema, taskDraftSchema, taskTypes, type Task } from '../../db/taskModels'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { taskStrings } from '../../i18n/tasks'
import { strings } from '../../i18n/strings'
import { localDay } from '../../lib/calendar'
import { Field, useLocalQuery } from '../animals/shared'
import { animalLabel } from '../health/HealthTimeline'
import { taskError } from './shared'

export function TaskForm({ language, task }: { language: Language; task?: Task }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const t = taskStrings[language]
  const labels = animalStrings[language]
  const animals = useLocalQuery(repositories.animals.list)
  const [animalId, setAnimalId] = useState(task?.animalId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const back = task ? '/tasks/' + task.id : '/tasks'
  const day = task?.dueDate ?? taskDatesSchema.shape.from.safeParse(params.get('date') || undefined).data ?? localDay()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current) return
    const form = new FormData(event.currentTarget)
    const parsed = taskDraftSchema.safeParse({
      title: form.get('title'), description: form.get('description') || undefined,
      type: task?.healthEventId ? task.type : form.get('type'), dueDate: form.get('dueDate'),
      animalId: task?.healthEventId ? task.animalId : form.get('animalId') || undefined,
    })
    if (!parsed.success) { setError(t.invalid); return }
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const saved = task ? await repositories.tasks.edit(task.id, parsed.data) : await repositories.tasks.create(parsed.data)
      navigate('/tasks/' + saved.id, { replace: true })
    } catch (error) {
      setError(taskError(error, language))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  return <div className="registry">
    <Link to={back} className="registry-link inline-flex min-h-11 items-center">{task ? t.task : t.calendar}</Link>
    <h1 className="mt-2">{task ? t.edit : t.add}</h1>
    <form className="panel mt-6 max-w-3xl" onSubmit={submit}>
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label={t.title}><input className="registry-control" name="title" required defaultValue={task?.title} /></Field>
        <Field label={t.dueDate}><input className="registry-control" name="dueDate" type="date" required defaultValue={day} /></Field>
        <Field label={t.type}><select className="registry-control" name="type" defaultValue={task?.type ?? 'general'} disabled={Boolean(task?.healthEventId)}>
          {taskTypes.map((type) => <option key={type} value={type}>{t[type]}</option>)}
        </select></Field>
        <Field label={labels.registry}><select className="registry-control" name="animalId" value={animalId} onChange={(event) => setAnimalId(event.target.value)}
          disabled={Boolean(task?.healthEventId) || !animals?.data}>
          <option value="">{t.noAnimal}</option>
          {task?.animalId && !animals?.data && <option value={task.animalId}>{task.animalId}</option>}
          {[...(animals?.data ?? [])].sort((a, b) => a.earTag.localeCompare(b.earTag, language, { numeric: true }))
            .map((animal) => <option key={animal.id} value={animal.id}>{animalLabel(animal)} · {labels[animal.status]}</option>)}
        </select></Field>
        <div className="sm:col-span-2"><Field label={t.description}>
          <textarea className="registry-control" name="description" rows={4} defaultValue={task?.description} />
        </Field></div>
      </fieldset>
      {(error || animals?.error) && <p role="alert" className="registry-error mt-4">{error || strings[language].error}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="registry-action" disabled={busy || !animals?.data}>{busy ? strings[language].saving : t.save}</button>
        <Link to={back} className="registry-action secondary">{labels.cancel}</Link>
      </div>
    </form>
  </div>
}
