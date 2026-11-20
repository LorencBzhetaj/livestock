import { getAccess } from '../features/auth/access'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { animalStrings } from '../i18n/animals'
import { healthStrings } from '../i18n/health'
import { taskStrings } from '../i18n/tasks'
import { strings } from '../i18n/strings'
import type { Language } from '../db/models'

export function Shell({ language, online, children }: {
  language: Language
  online: boolean
  children: ReactNode
}) {
  const t = strings[language]
  return (
    <>
      <a href="#main" className="skip-link">{t.skip}</a>
      <header className="bg-pine text-cream">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3 text-lg font-semibold">
            <img src={import.meta.env.BASE_URL + 'icon-192.png'} alt="" width="36" height="36" />
            LivestockOS
          </div>
          <p role="status" className="text-sm text-cream">
            <span className="mr-2 inline-block size-2 rounded-full bg-gold" aria-hidden="true" />
            {online ? t.online : t.offline} <span aria-hidden="true">·</span> {t.local}
          </p>
        </div>
        <nav aria-label={t.navigation} className="mx-auto flex max-w-5xl flex-wrap gap-x-5 px-5 sm:px-8">
          <NavLink to="/" end>{t.overview}</NavLink>
          <NavLink to="/animals">{animalStrings[language].registry}</NavLink>
          <NavLink to="/veterinary">{healthStrings[language].veterinary}</NavLink>
          <NavLink to="/tasks">{taskStrings[language].calendar}</NavLink>
          {getAccess()?.role !== 'VETERINARIAN' && <NavLink to="/settings">{t.settings}</NavLink>}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        {children}
      </main>
    </>
  )
}
