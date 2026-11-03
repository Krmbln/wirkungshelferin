import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/styles/base.css'
import { Root } from './ui/Root'
import type { NavigatorWithUAData } from './ui/gate/isGoogleChrome'

const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
const root = createRoot(document.getElementById('root')!)

// Dev-only state gallery at ?gallery. import.meta.env.DEV is false in the build,
// so the branch and the gallery chunk are dropped (checked in tests/dist).
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('gallery')) {
  void import('./gallery/Gallery').then(({ Gallery }) =>
    root.render(
      <StrictMode>
        <Gallery appUrl={appUrl} />
      </StrictMode>,
    ),
  )
} else {
  root.render(
    <StrictMode>
      <Root nav={navigator as NavigatorWithUAData} appUrl={appUrl} />
    </StrictMode>,
  )
}
