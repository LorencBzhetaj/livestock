import { liveQuery } from 'dexie'
import type { LivestockDatabase } from '../../db/database'
import { acknowledge, applyPage, nextEntry, retry } from './local'
import { getSession, pull, push, SyncHttpError } from './client'

export type SyncStatus = 'unlinked' | 'offline' | 'pending' | 'working' | 'synced' | 'conflict' | 'failed'

export function watchSync(db: LivestockDatabase, update: (status: SyncStatus) => void) {
  let disposed = false
  let running = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule(delay = 250) {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(() => { void run() }, delay)
  }

  async function synchronize() {
    const state = await db.syncState.get('farm')
    if (!state || disposed) return update('unlinked')
    if (!navigator.onLine) return update('offline')
    let entry = await nextEntry(db)
    if (entry?.status === 'conflict') return update('conflict')
    if (entry && entry.retryAt > Date.now()) {
      update('pending')
      return schedule(entry.retryAt - Date.now())
    }
    update('working')
    const session = await getSession()
    if (session.farmId !== state.farmId || session.deviceId !== state.deviceId || session.identityId !== state.identityId) throw new Error('The local device does not match its session')
    if (session.role === 'VETERINARIAN' && entry) throw new Error('Read-only account has pending edits')
    for (let count = 0; entry && count < 30 && !disposed; count++) {
      if (entry.status === 'conflict') return update('conflict')
      if (entry.retryAt > Date.now()) {
        update('pending')
        return schedule(entry.retryAt - Date.now())
      }
      try {
        const result = await push(entry.operation)
        await acknowledge(db, entry, result)
      } catch (error) {
        if (!(error instanceof SyncHttpError && error.status === 401)) {
          await retry(db, entry)
          schedule(Math.min(300_000, 1000 * 2 ** Math.min(entry.attempts + 1, 9)))
        }
        throw error
      }
      entry = await nextEntry(db)
    }
    if (entry) {
      update('pending')
      return schedule(500)
    }
    for (let count = 0; count < 30 && !disposed; count++) {
      if (await nextEntry(db)) return schedule()
      const current = await db.syncState.get('farm')
      if (!current || current.deviceId !== session.deviceId) return update('unlinked')
      const page = await pull(current.cursor)
      await applyPage(db, session, current.cursor, page)
      if (!page.more) return update('synced')
    }
    schedule(500)
  }

  async function run() {
    if (disposed || running) return
    running = true
    try {
      if (navigator.locks) await navigator.locks.request('livestock-sync:' + db.name, synchronize)
      else await synchronize()
      failures = 0
    } catch (error) {
      if (!disposed) update(navigator.onLine ? 'failed' : 'offline')
      if (navigator.onLine && !(error instanceof SyncHttpError && [401, 403, 409, 413].includes(error.status))) {
        failures += 1
        schedule(Math.min(300_000, 1000 * 2 ** Math.min(failures, 9)))
      }
    } finally { running = false }
  }

  const observer = liveQuery(async () => [await db.syncState.get('farm'), await nextEntry(db)]).subscribe({
    next: () => schedule(), error: () => update('failed'),
  })
  const wake = () => schedule()
  const visible = () => { if (document.visibilityState === 'visible') schedule() }
  window.addEventListener('online', wake)
  window.addEventListener('offline', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('livestock-sync', wake)
  document.addEventListener('visibilitychange', visible)
  schedule(0)
  return () => {
    disposed = true
    clearTimeout(timer)
    observer.unsubscribe()
    window.removeEventListener('online', wake)
    window.removeEventListener('offline', wake)
    window.removeEventListener('focus', wake)
    window.removeEventListener('livestock-sync', wake)
    document.removeEventListener('visibilitychange', visible)
  }
}
