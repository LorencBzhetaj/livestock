export type PwaState = 'preparing' | 'ready' | 'waiting' | 'insecure' | 'unavailable' | 'development'

export function watchPwa(setState: (state: PwaState) => void) {
  if (!window.isSecureContext) {
    setState('insecure')
    return
  }
  if (!('serviceWorker' in navigator)) {
    setState('unavailable')
    return
  }
  if (!import.meta.env.PROD) {
    setState('development')
    return
  }

  const workers = navigator.serviceWorker
  let registration: ServiceWorkerRegistration | undefined
  let installing: ServiceWorker | null = null
  let stopped = false

  function refresh() {
    if (stopped) return
    if (workers.controller) setState(registration?.waiting ? 'waiting' : 'ready')
    else if (installing?.state === 'redundant') setState('unavailable')
    else setState('preparing')
  }

  function watchInstallation() {
    installing?.removeEventListener('statechange', refresh)
    installing = registration?.installing ?? null
    installing?.addEventListener('statechange', refresh)
    refresh()
  }

  workers.addEventListener('controllerchange', refresh)
  refresh()
  void workers.register(import.meta.env.BASE_URL + 'sw.js', { updateViaCache: 'none' }).then((result) => {
    if (stopped) return
    registration = result
    registration.addEventListener('updatefound', watchInstallation)
    watchInstallation()
  }, () => {
    if (!stopped) setState(workers.controller ? 'ready' : 'unavailable')
  })

  return () => {
    stopped = true
    registration?.removeEventListener('updatefound', watchInstallation)
    installing?.removeEventListener('statechange', refresh)
    workers.removeEventListener('controllerchange', refresh)
  }
}
