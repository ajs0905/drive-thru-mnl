import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The road sign font (Overpass, OFL), bundled so it works offline and without a font service.
import '@fontsource-variable/overpass'
import './index.css'
import App from './App.tsx'
import { startAnalytics } from './analytics'

startAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
