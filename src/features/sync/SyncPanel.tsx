import { getAccess, authRequired } from '../auth/access'
import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { z } from 'zod'
import type { Language } from '../../db/models'
import { database } from '../../db/repositories'
import { enroll, getSession, invite, pull, request, revoke } from './client'
import { checkInitial, connectLocal, detach, nextEntry, previewLocal, recoverSession, resolve, snapshotRemote, type Journal, type SyncState } from './local'
import { watchSync, type SyncStatus } from './coordinator'
import { devicesSchema, type Mutation, type Session } from './protocol'

const sq = {
  title: 'Sinkronizimi', unlinked: 'Kjo pajisje punon lokalisht.', offline: 'Pa internet', pending: 'Ndryshime në pritje',
  working: 'Duke sinkronizuar…', synced: 'Të dhënat janë të sinkronizuara', conflict: 'Konflikt për shqyrtim',
  failed: 'Sinkronizimi dështoi. Të dhënat lokale ruhen.', code: 'Kodi i regjistrimit të pajisjes',
  device: 'Emri i pajisjes', enroll: 'Regjistro pajisjen', review: 'Shqyrto të dhënat', confirm: 'Konfirmo bashkimin',
  sync: 'Sinkronizo tani', invite: 'Krijo kod për një pajisje tjetër', hide: 'Fshih kodin', devices: 'Pajisjet',
  revoke: 'Hiq qasjen', revoked: 'Qasja u hoq', localCount: 'Regjistrime lokale', remoteCount: 'Regjistrime nga serveri',
  reviewHelp: 'Kontrollo të dyja listat para bashkimit. Konfliktet ruhen për shqyrtim.',
  keepLocal: 'Dërgo versionin lokal', keepServer: 'Përdor versionin e serverit', current: 'Versioni i serverit',
  draft: 'Versioni lokal', reason: 'Shkaku', detach: 'Kalo në përdorim lokal',
  detachHelp: 'Ndalo sinkronizimin para rikthimit të një kopjeje rezervë. Ndryshimet në pritje duhet të përfundojnë.',
  photos: 'Fotografitë ruhen në këtë pajisje dhe në kopjet rezervë.',
  actionError: 'Veprimi nuk përfundoi. Kontrollo kodin, lidhjen ose konfliktet e të dhënave.',
  stale: 'Regjistrimi ka një version tjetër.', constraint: 'Kontrollo etiketat, lidhjet ose korrigjimet klinike.',
  initial: 'Të dhënat në server ndryshuan gjatë konfigurimit.',
  remap: 'Llojet identike do të përdorin identifikuesit e serverit',
  invalidReview: 'Të dhënat kanë etiketa, lloje ose lidhje të papajtueshme. Rregulloji para bashkimit.',
}
const en: typeof sq = {
  title: 'Synchronization', unlinked: 'This device works locally.', offline: 'Offline', pending: 'Local changes pending',
  working: 'Synchronizing…', synced: 'Fully synchronized', conflict: 'Conflict needs review',
  failed: 'Synchronization failed. Local records are kept.', code: 'Device enrollment code',
  device: 'Device name', enroll: 'Enroll device', review: 'Review records', confirm: 'Confirm reconciliation',
  sync: 'Sync now', invite: 'Create a code for another device', hide: 'Hide code', devices: 'Devices',
  revoke: 'Revoke access', revoked: 'Revoked', localCount: 'Local records', remoteCount: 'Server records',
  reviewHelp: 'Review both lists before merging. Conflicts are kept for review.',
  keepLocal: 'Send local version', keepServer: 'Use server version', current: 'Server version',
  draft: 'Local version', reason: 'Reason', detach: 'Switch to local mode',
  detachHelp: 'Pause synchronization before restoring a backup. Finish pending changes first.',
  photos: 'Photographs stay on this device and in backups.',
  actionError: 'The action failed. Check the code, connection, or record conflicts.',
  stale: 'The record has a different version.', constraint: 'Check identifiers, relationships, or clinical amendments.',
  initial: 'Server records changed during setup.',
  remap: 'Identical species will use the server identifiers',
  invalidReview: 'The records have incompatible tags, species, or references. Resolve them before merging.',
}
const words = { sq, en }

type Review = { session: Session; local: Mutation[]; remote: Awaited<ReturnType<typeof snapshotRemote>>; valid: boolean; remapped: number }
const shortName = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return ''
  for (const key of ['earTag', 'title', 'name', 'kind', 'code'] as const) {
    const value = (payload as Record<string, unknown>)[key]
    if (typeof value === 'string') return ' — ' + value
  }
  return ''
}

export default function SyncPanel({ language, settings }: { language: Language; settings: boolean }) {
  const t = words[language]
  const readOnly = getAccess()?.role === 'VETERINARIAN'
  const accountMode = authRequired()
  const [status, setStatus] = useState<SyncStatus>('unlinked')
  const [state, setState] = useState<SyncState>()
  const [entry, setEntry] = useState<Journal>()
  const [review, setReview] = useState<Review>()
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [devices, setDevices] = useState<z.infer<typeof devicesSchema>>()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!accountMode) return
    const identity = getAccess()
    if (!identity) return
    void recoverSession(database, identity).then(() => {
      window.dispatchEvent(new Event('livestock-sync'))
    }).catch(() => setFailed(true))
  }, [accountMode])
  useEffect(() => watchSync(database, setStatus), [])
  useEffect(() => {
    const sub = liveQuery(async () => ({
      state: await database.syncState.get('farm'), entry: await nextEntry(database),
    })).subscribe(({ state, entry }) => { setState(state); setEntry(entry) })
    return () => sub.unsubscribe()
  }, [])

  async function perform(work: () => Promise<unknown>) {
    setPending(true)
    setFailed(false)
    try { await work() } catch { setFailed(true) } finally { setPending(false) }
  }
  async function reviewSession(session: Session) {
    if (state) return await recoverSession(database, session)
    const local = await previewLocal(database)
    const remote = await snapshotRemote(pull)
    let valid = true
    let remapped = 0
    try { remapped = checkInitial(local, remote.records).remapped.size } catch { valid = false }
    setReview({ session, local, remote, valid, remapped })
  }
  const wake = () => window.dispatchEvent(new Event('livestock-sync'))
  if (!settings) return state ? <p className="mb-3 text-sm" role="status">{t[status]}</p> : null

  return <section className="panel mt-4" aria-labelledby="sync-heading">
    <h2 id="sync-heading">{t.title}</h2>
    <p role="status">{t[status]}</p>
    <p className="text-sm">{t.photos}</p>
    {failed && <p role="alert" className="text-red-800">{t.actionError}</p>}
    {!accountMode && (!state || status === 'failed') && <form className="mt-3 grid gap-2" onSubmit={(event) => {
      event.preventDefault()
      void perform(async () => {
        const session = await enroll(code.trim(), label.trim())
        setCode('')
        await reviewSession(session)
      })
    }}>
      <label>{t.device}<input required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>{t.code}<input type="password" required autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <button disabled={pending}>{t.enroll}</button>
    </form>}
    {!state && <button disabled={pending} onClick={() => void perform(async () => reviewSession(await getSession()))}>{t.review}</button>}
    {review && <div className="my-3">
      <p>{t.reviewHelp}</p>
      <details><summary>{t.localCount} ({review.local.length})</summary>
        <ul className="max-h-48 overflow-auto">{review.local.map((row) =>
          <li key={row.entity + row.recordId}>{row.entity}{shortName(row.payload)}</li>)}</ul>
      </details>
      <details><summary>{t.remoteCount} ({review.remote.records.length})</summary>
        <ul className="max-h-48 overflow-auto">{review.remote.records.map((row) =>
          <li key={row.entity + row.recordId}>{row.entity}{shortName(row.payload)}</li>)}</ul>
      </details>
      {review.remapped > 0 && <p>{t.remap} ({review.remapped})</p>}
      {!review.valid && <p role="alert">{t.invalidReview}</p>}
      <button disabled={pending || !review.valid} onClick={() => void perform(async () => {
        await connectLocal(database, review.session, review.local, review.remote.records, review.remote.cursor)
        setReview(undefined)
        wake()
      })}>{t.confirm}</button>
    </div>}
    {state && <>
      <p>{state.name}</p>
      <button disabled={pending} onClick={wake}>{t.sync}</button>
      {!accountMode && <button disabled={pending} onClick={() => void perform(async () => setInviteCode((await invite()).code))}>{t.invite}</button>}
      {inviteCode && <div><output className="break-all">{inviteCode}</output><button onClick={() => setInviteCode('')}>{t.hide}</button></div>}
      {!readOnly && <button disabled={pending} onClick={() => void perform(async () => {
        const result = await request({ action: 'devices' }, z.object({ devices: devicesSchema }))
        setDevices(result.devices)
      })}>{t.devices}</button>}
      {!readOnly && devices && <ul>{devices.map((device) => <li key={device.id}>
        {device.label} {device.revoked ? t.revoked : device.id !== state.deviceId &&
          <button disabled={pending} onClick={() => void perform(async () => {
            await revoke(device.id)
            setDevices(devices.map((item) => item.id === device.id ? { ...item, revoked: true } : item))
          })}>{t.revoke}</button>}
      </li>)}</ul>}
      <p className="text-sm">{t.detachHelp}</p>
      {!readOnly && <button disabled={pending || Boolean(entry)} onClick={() => void perform(() => detach(database))}>{t.detach}</button>}
    </>}
    {!readOnly && entry?.status === 'conflict' && entry.conflict && <article className="mt-4 border-t pt-3">
      <h3>{t.conflict}</h3>
      <p>{t[entry.conflict.reason]}</p>
      <details><summary>{t.draft}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(entry.operation.mutations.map((m) => m.payload), null, 2)}</pre></details>
      <details><summary>{t.current}</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(entry.conflict.current.map((m) => m.payload), null, 2)}</pre></details>
      <button disabled={pending} onClick={() => void perform(() => resolve(database, entry.sequence!, 'server'))}>{t.keepServer}</button>
      <button disabled={pending} onClick={() => void perform(() => resolve(database, entry.sequence!, 'local'))}>{t.keepLocal}</button>
    </article>}
  </section>
}
