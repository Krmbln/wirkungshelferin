import { useEffect, useRef, useState } from 'react'
import { unanswered } from '../ai/chat'
import { backupState } from '../domain/backup'
import type { Action } from '../domain/reducer'
import type { Project } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import type { Drafts } from '../storage/drafts'
import { defaultSettings, type Settings as SettingsValue } from '../storage/settings'
import { stepIntro } from '../guide/intro'
import { BlockPanel } from './block/BlockPanel'
import { Chat } from './chat/Chat'
import type { ChatControls } from './chat/useChatRunner'
import { Banner } from './components/Banner'
import { Button } from './components/Button'
import { Home } from './frame/Home'
import { PageHeader } from './frame/PageHeader'
import { Settings, type SettingsProps } from './frame/Settings'
import { Sidebar } from './frame/Sidebar'
import { StepWorkspace } from './frame/StepWorkspace'
import { statusesOf, steps, type View } from './steps'
import { useNow } from './useNow'
import './App.css'

type Props = {
  project: Project
  /** Gallery and tests start on a given view; the app starts at home. */
  initialView?: View
  /** Time of the last successful save; "Gespeichert" shows for 2 s after it changes. */
  savedAt?: number
  /** The last save failed: the ⛔ banner stays until a save succeeds (design §7.4). */
  saveFailed?: boolean
  /** Downloads a backup; the project records the time (sidebar, reminder). */
  onSaveBackup?: () => void
  settings?: SettingsValue
  onSettingsChange?: (settings: SettingsValue) => Promise<void>
  onReplaceProject?: SettingsProps['onReplaceProject']
  previousVersion?: number
  onRestorePrevious?: () => Promise<void>
  testConnection?: SettingsProps['testConnection']
  /** Gallery and tests pin the clock; the app follows the real one. */
  now?: Date
  /** Chat turns (Session's runner); the gallery passes fixed runs. */
  chat?: ChatControls
  drafts?: Drafts
  onDraftChange?: (step: StepId, text: string) => void
  /** Lukas's edits in the block panel (Session: reducer + save at once). */
  onBlockAction?: (action: Action) => void
}

const noop = () => {}
const resolved = async () => {}
const connected = async () => ({ ok: true }) as const
const idleChat: ChatControls = { runs: {}, send: noop, stop: noop, retry: noop }

// No router (tech design §2): app state decides the view.
export function App({
  project,
  initialView = { kind: 'home' },
  savedAt,
  saveFailed = false,
  onSaveBackup = noop,
  settings = defaultSettings,
  onSettingsChange = resolved,
  onReplaceProject = resolved,
  previousVersion,
  onRestorePrevious,
  testConnection = connected,
  now: fixedNow,
  chat = idleChat,
  drafts = {},
  onDraftChange = noop,
  onBlockAction = noop,
}: Props) {
  const [view, setView] = useState<View>(initialView)
  const now = useNow(fixedNow)
  const backup = backupState(project, now)
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
      <Sidebar view={view} statuses={statuses} backup={backup} onNavigate={setView} />
      <main className={`app__main app__main--${view.kind}`}>
        {saveFailed && (
          <div className="app__alert">
            <Banner
              tone="block"
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSaveBackup()
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
        {view.kind === 'home' && (
          <Home
            statuses={statuses}
            backup={backup}
            onOpenStep={(step) => setView({ kind: 'step', step })}
            onSaveBackup={onSaveBackup}
          />
        )}
        {view.kind === 'step' && (
          <StepWorkspace
            key={view.step}
            step={steps[view.step]}
            block={<BlockPanel project={project} step={view.step} onAction={onBlockAction} />}
            chat={
              <Chat
                segments={project.steps[view.step].segments}
                intro={stepIntro(view.step)}
                now={now}
                proposals={project.steps[view.step].proposals}
                run={chat.runs[view.step]}
                unanswered={unanswered(project, view.step)}
                draft={drafts[view.step] ?? ''}
                onDraftChange={(text) => onDraftChange(view.step, text)}
                onSend={(text) => chat.send(view.step, text)}
                onStop={() => chat.stop(view.step)}
                onRetry={() => chat.retry(view.step)}
                onOpenSettings={() => setView({ kind: 'settings' })}
                model={settings.model}
              />
            }
          />
        )}
        {view.kind === 'settings' && (
          <Settings
            settings={settings}
            onSettingsChange={onSettingsChange}
            backup={backup}
            onSaveBackup={onSaveBackup}
            onReplaceProject={onReplaceProject}
            previousVersion={previousVersion}
            onRestorePrevious={onRestorePrevious}
            testConnection={testConnection}
          />
        )}
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
