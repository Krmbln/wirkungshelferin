import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './ui/Root'
import type { NavigatorWithUAData } from './ui/gate/isGoogleChrome'

const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root nav={navigator as NavigatorWithUAData} appUrl={appUrl} />
  </StrictMode>,
)
