import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { authRequired } from './features/auth/access'
const Entry = authRequired()
  ? lazy(() => import('./features/auth/Gate'))
  : lazy(() => import('./app/App').then(m => ({default: m.App})))
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Suspense fallback={<p role="status">…</p>}><Entry /></Suspense>
    </BrowserRouter>
  </StrictMode>,
)
