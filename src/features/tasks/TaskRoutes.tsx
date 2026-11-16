import { Route, Routes } from 'react-router-dom'
import type { Language } from '../../db/models'
import { taskStrings } from '../../i18n/tasks'
import { CalendarPage } from './CalendarPage'
import { TaskDetails } from './TaskDetails'
import { TaskForm } from './TaskForm'

export default function TaskRoutes({ language }: { language: Language }) {
  return <Routes>
    <Route index element={<CalendarPage language={language} />} />
    <Route path="new" element={<TaskForm language={language} />} />
    <Route path=":id" element={<TaskDetails language={language} />} />
    <Route path=":id/edit" element={<TaskDetails editing language={language} />} />
    <Route path="*" element={<p role="alert">{taskStrings[language].missing}</p>} />
  </Routes>
}
