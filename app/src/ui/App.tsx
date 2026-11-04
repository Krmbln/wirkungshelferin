import { useEffect, useRef, useState } from 'react'
import { Home } from './frame/Home'
import { PageHeader } from './frame/PageHeader'
import { Settings } from './frame/Settings'
import { Sidebar } from './frame/Sidebar'
import { StepWorkspace } from './frame/StepWorkspace'
import { initialStatuses, steps, type StepStatuses, type View } from './steps'
import './App.css'

type Props = {
  /** Gallery and tests start on a given view; the app starts at home. */
  initialView?: View
  /** Placeholder statuses until the stored project exists (step 5). */
  statuses?: StepStatuses
}

// No router (tech design §2): app state decides the view.
export function App({ initialView = { kind: 'home' }, statuses = initialStatuses }: Props) {
  const [view, setView] = useState<View>(initialView)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  const header = headerFor(view)

  useEffect(() => {
    document.title = view.kind === 'home' ? 'Wirkungshelferin' : `${header.title} – Wirkungshelferin`
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    // A sidebar row keeps focus. A button that left with the old view (Weiter, a home row)
    // would drop focus to <body>, so it moves to the new page title instead.
    if (!document.activeElement || document.activeElement === document.body) heading.current?.focus()
  }, [view, header.title])

  return (
    <div className="app">
      <Sidebar view={view} statuses={statuses} onNavigate={setView} />
      <main className={`app__main app__main--${view.kind}`}>
        <p className="app__narrow-hint">
          Zieh das Fenster etwas breiter, dann siehst du Chat und Baustein nebeneinander.
        </p>
        <PageHeader title={header.title} meta={header.meta} headingRef={heading} />
        {view.kind === 'home' && <Home statuses={statuses} onOpenStep={(step) => setView({ kind: 'step', step })} />}
        {view.kind === 'step' && <StepWorkspace key={view.step} step={steps[view.step]} />}
        {view.kind === 'settings' && <Settings />}
      </main>
    </div>
  )
}

function headerFor(view: View): { title: string; meta?: string } {
  if (view.kind === 'home') return { title: 'Übersicht' }
  if (view.kind === 'settings') return { title: 'Einstellungen' }
  const step = steps[view.step]
  return { title: step.title, meta: `Schritt ${step.id} · ${step.part}` }
}
