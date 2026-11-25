import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { notificationStrings } from '../../i18n/notifications'
import { now } from '../../lib/identity'
import { sha256 } from '../../lib/sha256'
import { useLocalQuery } from '../animals/shared'
import { capabilities, durableAction, loadPushConfig, requestNotificationPermission, sendTest, subscribeDevice } from './client'
import { notificationPreferences, preferenceKey } from './models'
import {authRequired} from '../auth/access'
import ScheduledSettings from './ScheduledSettings'

const readPreferences = () => repositories.settings.get(preferenceKey)

export default function NotificationSettings({ language, online }: { language: Language; online: boolean }) {
  return authRequired()?<ScheduledSettings language={language} online={online}/>:<LegacySettings language={language} online={online}/>
}
function LegacySettings({language,online}:{language:Language;online:boolean}){
  const t = notificationStrings[language]
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const [subscription, setSubscription] = useState<PushSubscription | null>()
  const [permission, setPermission] = useState<NotificationPermission>()
  const [config, setConfig] = useState<Awaited<ReturnType<typeof loadPushConfig>>>()
  const [draft, setDraft] = useState<ReturnType<typeof notificationPreferences.parse>>()
  const stored = useLocalQuery(readPreferences)
  const preferences = draft ?? notificationPreferences.safeParse(stored?.data?.value).data ??
    { language, reminderTime: '08:00', leadDays: 7 }
  const [token, setToken] = useState('')
  const [code, setCode] = useState('')
  const [lastTest, setLastTest] = useState<keyof typeof t>()
  const [checkingTest, setCheckingTest] = useState(false)
  const enrollmentAttempt = useRef<string>(undefined)
  const testAttempt = useRef<{ requestId: string; language: Language }>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<keyof typeof t>()
  const [cooldown, setCooldown] = useState(false)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const locked = useRef(false)
  const intent = useRef(0)
  const sw = navigator.serviceWorker
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const ability = capabilities({
    secure: window.isSecureContext, standalone, notification: typeof Notification !== 'undefined',
    push: 'PushManager' in window || Boolean(registration?.pushManager), registration: Boolean(registration?.pushManager),
  })

  useEffect(() => () => clearTimeout(cooldownTimer.current), [])

  useEffect(() => {
    let live = true
    function refresh() {
      const revision = intent.current
      if (online) void loadPushConfig().then(
        (value) => { if (live && revision === intent.current) setConfig(value) },
        () => { if (live && revision === intent.current) setConfig(undefined) },
      )
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { live = false; window.removeEventListener('focus', refresh) }
  }, [online])

  useEffect(() => {
    let live = true
    function refresh() {
      if (typeof Notification !== 'undefined') setPermission(Notification.permission)
      const version = intent.current
      void sw?.getRegistration().then(async (current) => {
        if (live) setRegistration(current?.active ? current : undefined)
        const existing = await current?.pushManager?.getSubscription()
        if (live && version === intent.current) setSubscription(existing ?? null)
      }).catch(() => { if (live && version === intent.current) setSubscription(undefined) })
    }
    refresh()
    sw?.addEventListener('controllerchange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      live = false
      sw?.removeEventListener('controllerchange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [sw])

  async function action(run: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    intent.current++
    setBusy(true)
    setNotice(undefined)
    try { await run() } catch { setNotice('failure') }
    finally { locked.current = false; setBusy(false) }
  }

  function enable() {
    if (!ability.supported || !online || typeof Notification === 'undefined') return
    void action(async () => {
      if (Notification.permission !== 'granted') {
        const next = await requestNotificationPermission(Notification)
        setPermission(next)
        if (next === 'granted') setNotice('approved')
        return
      }
      if (!registration || !config?.publicKey || subscription !== null) return
      try {
        setSubscription(await subscribeDevice(registration.pushManager, config.publicKey))
      } catch (error) {
        const existing = await registration.pushManager.getSubscription()
        if (!existing) throw error
        setSubscription(existing)
      }
      setNotice('ready')
    })
  }

  async function remove(current: PushSubscription) {
    await current.unsubscribe()
    const remaining = await registration?.pushManager.getSubscription()
    setSubscription(remaining ?? null)
    if (remaining) throw new Error('Subscription still active')
  }

  function markEnrollment(enrolled: boolean) {
    setConfig((current) => current && { ...current, enrolled })
  }

  function enroll(event: FormEvent) {
    event.preventDefault()
    if (!subscription || !online || code.length !== 43) return
    void action(async () => {
      enrollmentAttempt.current ??= crypto.randomUUID()
      const status = await durableAction({
        action: 'enroll', code, requestId: enrollmentAttempt.current, subscription: subscription.toJSON(),
      })
      if (status === 'enrolled') {
        markEnrollment(true)
        enrollmentAttempt.current = undefined
        setCode('')
      }
      setNotice(status)
    })
  }

  function revoke() {
    if (!online) return
    void action(async () => {
      const status = await durableAction({ action: 'revoke' })
      if (status === 'revoked') {
        markEnrollment(false)
        testAttempt.current = undefined
        setCheckingTest(false)
        if (subscription) {
          try { await remove(subscription) } catch { /* The server has already revoked this device. */ }
        }
      }
      setNotice(status)
    })
  }

  function sendDurableTest() {
    if (!online || !subscription || !config?.enrolled) return
    void action(async () => {
      testAttempt.current ??= { requestId: crypto.randomUUID(), language: preferences.language }
      setCheckingTest(true)
      let status: Awaited<ReturnType<typeof durableAction>>
      try {
        const endpointHash = await sha256(new TextEncoder().encode(subscription.endpoint))
        status = await durableAction({ action: 'test', ...testAttempt.current, endpointHash })
      }
      catch { setLastTest('failure'); return }
      setLastTest(status)
      if (status === 'providerAccepted' || status === 'providerRejected' || status === 'rejected' || status === 'expired') {
        testAttempt.current = undefined
        setCheckingTest(false)
      }
      if (status === 'expired') {
        markEnrollment(false)
        try { await remove(subscription) } catch { /* Leave the local subscription visible for manual removal. */ }
      }
    })
  }

  function save(event: FormEvent) {
    event.preventDefault()
    void action(async () => {
      const value = notificationPreferences.parse(preferences)
      await repositories.settings.save({ key: preferenceKey, value, updatedAt: now() })
      setDraft(undefined)
      setNotice('saved')
    })
  }

  const canEnable = ability.supported && online && config?.publicKey && permission !== 'denied' &&
    permission !== undefined && subscription === null
  return <section className="panel mt-4" aria-labelledby="notification-heading">
    <h2 id="notification-heading">{t.heading}</h2>
    <p className="mt-2 max-w-prose">{t.ios}</p>
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
      {([
        [t.browser, ability.supported ? t.yes : t.no], [t.standalone, standalone ? t.installed : t.browserTab],

        [t.permission, permission ? t[permission] : t.no],
        [t.enrollment, config?.enrollmentEnabled ? (config.enrolled ? t.enrolled : t.notEnrolled) : t.no],
        [t.subscription, subscription ? t.active : subscription === null ? t.none : ability.supported ? t.checking : t.no],
      ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>)}
    </dl>
    <details className="mt-3 text-sm"><summary>{language==='sq'?'Detajet e pajisjes':'Device details'}</summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><dt>{t.notificationApi}</dt><dd>{ability.notification?t.yes:t.no}</dd></div>
        <div><dt>{t.pushApi}</dt><dd>{ability.push?t.yes:t.no}</dd></div>
      </dl>
    </details>
    {!ability.supported && <p className="mt-3">{t.unavailable}</p>}
    {permission === 'denied' && <p className="mt-3">{t.deniedHelp}</p>}
    {!online && <p className="mt-3">{t.offline}</p>}
    {ability.supported && online && !config?.publicKey && <p className="mt-3">{t.noKey}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !canEnable} onClick={enable}>{permission === 'granted' && !subscription ? t.finish : t.enable}</button>
      <button disabled={busy || !subscription || Boolean(config?.enrolled)} onClick={() => {
        if (subscription) void action(async () => { await remove(subscription); setNotice('disabled') })
      }}>{t.disable}</button>
    </div>
    {subscription && config?.testEnabled && !config.enrollmentEnabled && navigator.clipboard && <div className="mt-3">
      <p className="text-sm">{t.private}</p>
      <button disabled={busy} onClick={() => void action(async () => {
        await navigator.clipboard.writeText(JSON.stringify(subscription.toJSON()))
        setNotice('copied')
      })}>{t.copy}</button>
    </div>}
    {config?.enrollmentEnabled ? <div className="mt-4">
      {config.enrolled ? <div className="flex flex-wrap gap-2">
        <button disabled={busy || !online} onClick={revoke}>{t.revoke}</button>
        <button disabled={busy || !online || !subscription || permission !== 'granted'} onClick={sendDurableTest}>
          {checkingTest ? t.checkTest : t.test}
        </button>
      </div> : <form onSubmit={enroll}>
        <label className="grid max-w-md gap-1 text-sm font-semibold">{t.code}
          <input className="registry-control" type="password" autoComplete="off" value={code} maxLength={43}
            onChange={(event) => { enrollmentAttempt.current = undefined; setCode(event.currentTarget.value) }} />
        </label>
        <button disabled={busy || !online || !subscription || permission !== 'granted' || code.length !== 43}>{t.enroll}</button>
      </form>}
      <p className="mt-3" role="status">{t.lastTest} · {t[lastTest ?? config.lastTest ?? 'noTest']}</p>
    </div> : config?.testEnabled ? <form className="mt-4" onSubmit={(event) => {
      event.preventDefault()
      if (!subscription || !online || cooldown || !token || locked.current) return
      setCooldown(true)
      cooldownTimer.current = setTimeout(() => setCooldown(false), 60_000)
      void action(async () => {
        setToken('')
        const result = await sendTest(subscription, token, preferences.language)
        if (result === 'expired') {
          try { await remove(subscription) } catch { /* Retain the actual subscription state for a manual retry. */ }
        }
        setNotice(result)
      })
    }}>
      <label className="grid max-w-md gap-1 text-sm font-semibold">{t.auth}
        <input className="registry-control" type="password" autoComplete="off" value={token} maxLength={43}
          onChange={(event) => setToken(event.currentTarget.value)} />
      </label>
      <button disabled={busy || cooldown || !online || !subscription || token.length !== 43}>{t.test}</button>
    </form> : <p className="mt-3">{t.testUnavailable}</p>}
    <form className="mt-5 border-t border-stone-200 pt-4" onSubmit={save}>
      <p className="mb-3">{t.local}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-semibold">{t.time}
          <input className="registry-control" type="time" required value={preferences.reminderTime}
            onChange={(event) => setDraft({ ...preferences, reminderTime: event.currentTarget.value })} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">{t.language}
          <select className="registry-control" value={preferences.language}
            onChange={(event) => setDraft({ ...preferences, language: event.currentTarget.value === 'sq' ? 'sq' : 'en' })}>
            <option value="sq">Shqip</option><option value="en">English</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">{t.lead}
          <input className="registry-control" type="number" min={0} max={30} required value={preferences.leadDays}
            onChange={(event) => setDraft({ ...preferences, leadDays: Number(event.currentTarget.value) })} />
        </label>
      </div>
      <button disabled={busy}>{t.save}</button>
    </form>
    {notice && <p role="status" className="mt-3">{t[notice]}</p>}
  </section>
}
