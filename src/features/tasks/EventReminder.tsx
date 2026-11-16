import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { taskStrings } from '../../i18n/tasks'
import { strings } from '../../i18n/strings'
import { useLocalQuery } from '../animals/shared'
import { displayDate } from '../health/entry'
import { taskError } from './shared'

async function readReminder(id: string) {
  const linked = await repositories.health.latest(id)
  if (!linked) return null
  const [source, existing] = await Promise.all([
    repositories.health.reminderSource(id), repositories.tasks.reminderAt(linked.rootId),
  ])
  return { source, existing }
}

export function EventReminder({ eventId, language }: { eventId: string; language: Language }) {
  const t = taskStrings[language]
  const query = useCallback(() => readReminder(eventId), [eventId])
  const result = useLocalQuery(query)
  const [review, setReview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const source = result?.data?.source
  const existing = result?.data?.existing

  async function confirm() {
    if (!source || !review || locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await repositories.tasks.fromEvent({ eventId, dueDate: review, title: t[source.type] })
      setReview(undefined)
    } catch (error) {
      setError(taskError(error, language))
      setReview(undefined)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }

  if (result?.error) return <p role="alert" className="registry-error mt-4">{strings[language].error}</p>
  if (!source && !existing && !error && !review) return null
  return <section className="panel mt-4 max-w-3xl">
    {source && <p>{t.currentSourceDate} · <time dateTime={source.dueDate}>{displayDate(source.dueDate, language)}</time></p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {existing
        ? <Link className="registry-action secondary" to={'/tasks/' + existing.id}>{t.viewReminder}</Link>
        : review && source
          ? <>
            <p className="w-full font-semibold">{t.reviewReminder} · {displayDate(review, language)}</p>
            <button className="registry-action" disabled={busy || source.dueDate !== review} onClick={() => void confirm()}>
              {busy ? strings[language].saving : t.confirmReminder}
            </button>
            <button className="registry-action secondary" disabled={busy} onClick={() => setReview(undefined)}>{animalStrings[language].cancel}</button>
          </>
          : source && <button className="registry-action secondary" onClick={() => { setReview(source.dueDate); setError('') }}>{t.addReminder}</button>}
    </div>
    {(error || (review && review !== source?.dueDate && !existing)) &&
      <p role="alert" className="registry-error mt-3">{error || t.reminderChanged}</p>}
    {review && !source && !existing && <button className="registry-action secondary" onClick={() => setReview(undefined)}>{animalStrings[language].cancel}</button>}
  </section>
}
