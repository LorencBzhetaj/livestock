import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import type { Language } from '../../db/models'
import { repositories } from '../../db/repositories'
import { animalStrings } from '../../i18n/animals'
import { strings } from '../../i18n/strings'
import { AnimalDetails } from './AnimalDetails'
import { NewAnimal } from './AnimalForm'
import { AnimalImport } from './AnimalImport'
import { AnimalList } from './AnimalList'
import { BackToAnimals } from './shared'

export default function AnimalRoutes({ language }: { language: Language }) {
  const [catalog, setCatalog] = useState<'ready' | 'error'>()
  useEffect(() => {
    let mounted = true
    void repositories.species.ensureCatalog().then(
      () => { if (mounted) setCatalog('ready') },
      () => { if (mounted) setCatalog('error') },
    )
    return () => { mounted = false }
  }, [])

  if (catalog === 'error') return <p role="alert">{strings[language].error}</p>
  if (!catalog) return <p role="status">{strings[language].loading}</p>
  return (
    <Routes>
      <Route index element={<AnimalList language={language} />} />
      <Route path="new" element={<NewAnimal language={language} />} />
      <Route path="import" element={<AnimalImport language={language} />} />
      <Route path=":id" element={<AnimalDetails language={language} />} />
      <Route path=":id/edit" element={<AnimalDetails language={language} editing />} />
      <Route path="*" element={<><BackToAnimals language={language} /><h1>{animalStrings[language].missing}</h1></>} />
    </Routes>
  )
}
