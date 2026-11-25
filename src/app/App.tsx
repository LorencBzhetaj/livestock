import { getAccess,authRequired } from '../features/auth/access'
import { useAccount } from '../features/auth/account'
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Shell } from '../components/Shell'
import { type Language } from '../db/models'
import { database, repositories, seedDemo } from '../db/repositories'
import { strings } from '../i18n/strings'
import { now } from '../lib/identity'
import { listenForRestore } from '../features/backup/restoreNotice'
import { pwaStrings } from '../i18n/pwa'
import { watchPwa, type PwaState } from './pwa'

const SyncPanel = lazy(() => import('../features/sync/SyncPanel'))
const NotificationSettings = lazy(() => import('../features/notifications/NotificationSettings'))
const BackupSettings = lazy(() => import('../features/backup/BackupSettings'))
const Dashboard = lazy(() => import('../features/tasks/Dashboard'))
const HealthRoutes = lazy(() => import('../features/health/HealthRoutes'))
const AnimalRoutes = lazy(() => import('../features/animals/AnimalRoutes'))
const TaskRoutes = lazy(() => import('../features/tasks/TaskRoutes'))

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function App() {
  const readOnly = getAccess()?.role === 'VETERINARIAN'
  const account = useAccount()
  const location = useLocation()
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  const [local, setLocal] = useState<{ language: Language; demo: boolean }>()
  const [readFailed, setReadFailed] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  const [pending, setPending] = useState(false)
  const [persistent, setPersistent] = useState<boolean>()
  const [pwa, setPwa] = useState<PwaState>('preparing')
  const [peerRestore, setPeerRestore] = useState(false)
  const language = local?.language ?? 'sq'
  const t = strings[language]

  useEffect(() => {
    const subscription = liveQuery(() => database.transaction(
      'r', database.settings, async () => {
        const language = (await repositories.settings.get('language'))?.value === 'en' ? 'en' : 'sq'
        const demo = (await repositories.settings.get('demoSeeded'))?.value === true
        return { language, demo } as const
      },
    )).subscribe({
      next: setLocal,
      error: () => setReadFailed(true),
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => watchPwa(setPwa), [])
  useEffect(()=>{
    if(!authRequired()||readOnly)return
    let disposed=false,stop:(()=>void)|undefined
    void import('../features/notifications/preferences').then(({watchReminderPreferences})=>{if(!disposed)stop=watchReminderPreferences(database)})
    return()=>{disposed=true;stop?.()}
  },[readOnly])
  useEffect(() => listenForRestore(() => setPeerRestore(true)), [])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  async function perform(action: () => Promise<unknown>) {
    setPending(true)
    setActionFailed(false)
    try {
      await action()
    } catch {
      setActionFailed(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Shell language={language} online={online}>
      {(readFailed || actionFailed) && <p role="alert" className="mb-5 text-red-800">{t.error}</p>}
      {pwa === 'waiting' && <p className="panel mb-5" role="status">{pwaStrings[language].waiting}</p>}
      {peerRestore && <p className="panel mb-5" role="status">{pwaStrings[language].peerRestore}</p>}
      {location.pathname !== '/settings' && <Suspense fallback={null}><SyncPanel language={language} settings={false} /></Suspense>}
      <fieldset disabled={readOnly && /\/(new|edit|import|batch|amend)(\/|$)/.test(location.pathname)} className="m-0 min-w-0 border-0 p-0">
      <Routes>
        <Route path="/" element={
          <Suspense fallback={<p role="status">{t.loading}</p>}><Dashboard language={language} /></Suspense>
        } />
        <Route path="/animals/*" element={
          <Suspense fallback={<p role="status">{t.loading}</p>}><AnimalRoutes language={language} /></Suspense>
        } />
        <Route path="/tasks/*" element={
          <Suspense fallback={<p role="status">{t.loading}</p>}><TaskRoutes language={language} /></Suspense>
        } />
        <Route path="/veterinary/*" element={
          <Suspense fallback={<p role="status">{t.loading}</p>}><HealthRoutes language={language} /></Suspense>
        } />
        <Route path="/vaccinations" element={<Suspense fallback={<p role="status">{t.loading}</p>}><HealthRoutes language={language} vaccinationOnly /></Suspense>} />
        <Route path="/reports" element={<Suspense fallback={<p role="status">{t.loading}</p>}><Dashboard language={language} reports /></Suspense>} />
        <Route path="/backup" element={readOnly ? <Navigate to="/" replace /> : <Suspense fallback={<p role="status">{t.loading}</p>}><BackupSettings language={language} /></Suspense>} />
        <Route path="/settings" element={readOnly ? <Navigate to="/" replace /> :
          <>
            <h1>{t.settings}</h1>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {account?.role === 'ADMIN' && <section className="panel sm:col-span-2" aria-labelledby="accounts-heading">
                <h2 id="accounts-heading">{language === 'sq' ? 'Llogaritë' : 'Accounts'}</h2>
                <p className="mt-2">{language === 'sq'
                  ? 'Krijo llogarinë e veterinerit ose ndrysho fjalëkalimin e saj. Veterineri sheh të dhënat, por nuk mund t\'i ndryshojë.'
                  : 'Create the veterinarian account or change its password. The veterinarian can view records but cannot change them.'}</p>
                <button onClick={account.openVet}>{language === 'sq' ? 'Llogaria e veterinerit' : 'Veterinarian account'}</button>
              </section>}
              <section className="panel sm:col-span-2">
                <label htmlFor="language" className="block font-semibold">{t.language}</label>
                <select id="language" value={language} disabled={!local || pending}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    void perform(() => repositories.settings.save({ key: 'language', value, updatedAt: now() }))
                  }}>
                  <option value="sq" lang="sq">Shqip</option>
                  <option value="en" lang="en">English</option>
                </select>
              </section>
              <section className="panel">
                <h2>{t.demo}</h2>
                <p className="mt-2" id="demo-help">{t.demoHelp}</p>
                {local?.demo
                  ? <p role="status" className="mt-4 font-medium">{t.demoAdded}</p>
                  : <button className="button-secondary" aria-describedby="demo-help" disabled={!local || pending}
                      onClick={() => void perform(() => seedDemo(database))}>{t.addDemo}</button>}
              </section>
              <section className="panel">
                <h2>{t.storage}</h2>
                <p className="mt-2">{getAccess()?(language==='sq'?'Puno edhe pa internet. Këtu mund të kontrollosh gjendjen e të dhënave të tua.':'Keep working offline. Check the status of your records here.'):t.localHelp}</p>
                <p className="mt-2">{t.storageWarning}</p>
                {pwa !== 'waiting' && <p className="mt-2 text-sm" role="status">{pwaStrings[language][pwa]}</p>}
                <button className="button-secondary" disabled={pending || persistent === true}
                  onClick={() => void perform(async () => setPersistent(await navigator.storage?.persist?.() ?? false))}>
                  {t.requestStorage}
                </button>
                {persistent !== undefined &&
                  <p role="status" className="mt-3">{persistent ? t.storageGranted : t.storageUnavailable}</p>}
              </section>
            </div>
            <Suspense fallback={null}><SyncPanel language={language} settings /></Suspense>
            <Suspense fallback={<p role="status">{t.loading}</p>}>
              <NotificationSettings language={language} online={online} />
            </Suspense>
            <Suspense fallback={<p role="status">{t.loading}</p>}><BackupSettings language={language} /></Suspense>
            {pending && <p role="status" className="mt-4">{t.saving}</p>}
          </>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </fieldset>

    </Shell>
  )
}
