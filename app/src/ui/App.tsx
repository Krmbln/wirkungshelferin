import { useEffect, useRef, useState } from 'react'
import type { Project } from '../domain/schemas/project'
import { Banner } from './components/Banner'
import { Button } from './components/Button'
import { Home } from './frame/Home'
import { PageHeader } from './frame/PageHeader'
import { Settings } from './frame/Settings'
import { Sidebar } from './frame/Sidebar'
import { StepWorkspace } from './frame/StepWorkspace'
import { statusesOf, steps, type View } from './steps'
import './App.css'

type Props = {
  project: Project
  /** Gallery and tests start on a given view; the app starts at home. */
  initialView?: View
  /** Time of the last successful save; "Gespeichert" shows for 2 s after it changes. */
  savedAt?: number
  /** The last save failed: the ⛔ banner stays until a save succeeds (design §7.4). */
  saveFailed?: boolean
  onSaveBackup?: () => void
}

// No router (tech design §2): app state decides the view.
export function App({ project, initialView = { kind: 'home' }, savedAt, saveFailed = false, onSaveBackup }: Props) {
  const [view, setView] = useState<View>(initialView)
  const [backupDownloaded, setBackupDownloaded] = useState(false)
  const statuses = statusesOf(project)
  // The note belongs to this failure; a new one starts without it.
  if (!saveFailed && backupDownloaded) setBackupDownloaded(false)
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
        {saveFailed && (
          <div className="app__alert">
            <Banner
              tone="block"
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSaveBackup?.()
                    setBackupDownloaded(true)
                  }}
                >
                  Backup speichern
                </Button>
              }
            >
              Speichern hat nicht geklappt – speichere jetzt ein Backup.
              {backupDownloaded && (
                <span className="banner__note">
                  Backup ist in deinen Downloads. Diese Meldung bleibt, bis Chrome wieder speichern kann.
                </span>
              )}
            </Banner>
          </div>
        )}
        <p className="app__narrow-hint">
          Zieh das Fenster etwas breiter, dann siehst du Chat und Baustein nebeneinander.
        </p>
        <PageHeader title={header.title} meta={header.meta} headingRef={heading} savedAt={savedAt} />
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
