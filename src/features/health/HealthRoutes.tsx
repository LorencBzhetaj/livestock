import { Route, Routes } from 'react-router-dom'
import type { Language } from '../../db/models'
import { healthStrings } from '../../i18n/health'
import { BatchVaccination } from './BatchVaccination'
import { HealthDetails } from './HealthDetails'
import { NewHealthEvent } from './HealthForm'
import { HealthOverview } from './HealthTimeline'

export default function HealthRoutes({ language, vaccinationOnly=false }: { language: Language; vaccinationOnly?:boolean }) {
  if(vaccinationOnly)return <HealthOverview language={language} vaccinationOnly />
  return (
    <Routes>
      <Route index element={<HealthOverview language={language} />} />
      <Route path="new" element={<NewHealthEvent language={language} />} />
      <Route path="batch" element={<BatchVaccination language={language} />} />
      <Route path="events/:id" element={<HealthDetails language={language} />} />
      <Route path="events/:id/amend" element={<HealthDetails language={language} editing />} />
      <Route path="*" element={<p role="alert">{healthStrings[language].missing}</p>} />
    </Routes>
  )
}
