import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Animal, Language } from '../../db/models'
import type { Task } from '../../db/taskModels'
import { TaskConflict } from '../../db/taskRepository'
import { taskStrings } from '../../i18n/tasks'
import { strings } from '../../i18n/strings'
import { isOverdue, localDay } from '../../lib/calendar'
import { displayDate } from '../health/entry'
import { animalLabel } from '../health/HealthTimeline'

export function useToday() {
  const [today, setToday] = useState(() => localDay())
  useEffect(() => {
    const update = () => setToday(localDay())
    const timer = window.setInterval(update, 30_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return today
}

export function taskError(error: unknown, language: Language) {
  const t = taskStrings[language]
  return error instanceof TaskConflict ? t[error.code] : strings[language].error
}

export function TaskState({ task, today, language }: { task: Task; today: string; language: Language }) {
  const overdue = isOverdue(task, today)
  const text = taskStrings[language][overdue ? 'overdue' : task.status]
  return <span className={overdue ? 'font-semibold text-red-800' : task.status === 'completed' ? 'font-semibold text-pine' : 'text-stone-700'}>{text}</span>
}

export function TaskList({ tasks, animals, language, today }: {
  tasks: Task[]; animals: Map<string, Animal>; language: Language; today: string
}) {
  if (!tasks.length) return <p className="mt-3">{taskStrings[language].empty}</p>
  return <ul className="mt-3 divide-y divide-stone-200">
    {tasks.map((task) => {
      const animal = task.animalId ? animals.get(task.animalId) : undefined
      return <li key={task.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 break-words">
          <Link className="registry-link inline-flex min-h-11 items-center font-semibold" to={'/tasks/' + task.id}>{task.title}</Link>
          {animal && <Link className="registry-link block w-fit" to={'/animals/' + animal.id}>{animalLabel(animal)}</Link>}
        </div>
        <p className="self-center"><time dateTime={task.dueDate}>{displayDate(task.dueDate, language)}</time>
          {' · '}<TaskState task={task} today={today} language={language} /></p>
      </li>
    })}
  </ul>
}
