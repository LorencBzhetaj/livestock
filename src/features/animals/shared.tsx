import { useEffect, useRef, useState, type ReactNode } from 'react'
import { liveQuery } from 'dexie'
import { Link } from 'react-router-dom'
import type { Language, Species } from '../../db/models'
import { animalStrings } from '../../i18n/animals'

export function useLocalQuery<T>(query: () => Promise<T>) {
  const [result, setResult] = useState<{ query: typeof query; data?: T; error?: true }>()
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (data) => setResult({ query, data }),
      error: () => setResult({ query, error: true }),
    })
    return () => subscription.unsubscribe()
  }, [query])
  return result?.query === query ? result : undefined
}

export function AnimalPhoto({ image, alt, className }: { image: Blob; alt: string; className: string }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const url = URL.createObjectURL(image)
    element.src = url
    return () => {
      element.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [image])
  return <img ref={ref} alt={alt} className={className} />
}

export function speciesName(species: Species, language: Language) {
  return language === 'sq' ? species.displayNameSq : species.displayNameEn
}

export function BackToAnimals({ language }: { language: Language }) {
  return <Link className="registry-link inline-flex min-h-11 items-center" to="/animals">{animalStrings[language].back}</Link>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid content-start gap-1 text-sm font-semibold">{label}{children}</label>
}

export function fieldLabel(field: string, t: typeof animalStrings.sq) {
  return Object.hasOwn(t, field) ? t[field as keyof typeof t] : field
}
