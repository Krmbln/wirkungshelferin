import { useCallback, useEffect, useRef, useState } from 'react'
import { unanswered } from '../ai/chat'
import { backupState } from '../domain/backup'
import type { Action } from '../domain/reducer'
import type { Project } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import type { Drafts } from '../storage/drafts'
import { defaultSettings, type Settings as SettingsValue } from '../storage/settings'
import { stepIntro } from '../guide/intro'
import { BlockPanel, type Applied } from './block/BlockPanel'
import { Chat } from './chat/Chat'
import type { ChatControls } from './chat/useChatRunner'
import { fieldSelector } from './check/gate'
import { QualityGate } from './check/QualityGate'
import type { CheckControls } from './check/useCheckRunner'
import { scrollIntoView } from './proposals/highlight'
import { Banner } from './components/Banner'
import { Button } from './components/Button'
import { Home } from './frame/Home'
import { ProposalCard, type TargetHint } from './proposals/ProposalCard'
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
  /** The gate's checks (Session's runner); the gallery passes a fake. */
  check?: CheckControls
}

const noop = () => {}
const resolved = async () => {}
const connected = async () => ({ ok: true }) as const
const idleChat: ChatControls = { runs: {}, send: noop, stop: noop, retry: noop }
const idleCheck: CheckControls = { runs: {}, check: async () => undefined }

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
  check = idleCheck,
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
          <StepView
            key={view.step}
            project={project}
            step={view.step}
            now={now}
            chat={chat}
            draft={drafts[view.step] ?? ''}
            onDraftChange={onDraftChange}
            onBlockAction={onBlockAction}
            onOpenSettings={() => setView({ kind: 'settings' })}
            model={settings.model}
            check={check}
            onSaveBackup={onSaveBackup}
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

type StepViewProps = {
  project: Project
  step: StepId
  now: Date
  chat: ChatControls
  draft: string
  onDraftChange: (step: StepId, text: string) => void
  onBlockAction: (action: Action) => void
  onOpenSettings: () => void
  model: string
  check: CheckControls
  onSaveBackup: () => void
}

/** "Zum Feld": scrolls the block column to the field and focuses it (design §6.2 state B). */
function goToField(target: Parameters<typeof fieldSelector>[0]) {
  const el = document.querySelector<HTMLElement>(`.workspace__block ${fieldSelector(target)}`)
  if (!el) return
  scrollIntoView(el)
  el.focus({ preventScroll: true })
}

// One step: chat and block, and what links them (outline, highlight, jump). Keyed by step,
// so that link state starts fresh on every step.
function StepView({ project, step, now, chat, draft, onDraftChange, onBlockAction, onOpenSettings, model, check, onSaveBackup }: StepViewProps) {
  const [outlined, setOutlined] = useState<TargetHint>()
  const [applied, setApplied] = useState<Applied>()
  const [jump, setJump] = useState<{ proposalId: string; n: number }>()
  const state = project.steps[step]
  const clearJump = useCallback(() => setJump(undefined), [])

  return (
    <StepWorkspace
      step={steps[step]}
      check={
        step === 1 ? (
          <QualityGate
            project={project}
            step={step}
            now={now}
            model={model}
            run={check.runs[step]}
            chatBusy={!!chat.runs[step] && chat.runs[step]?.kind !== 'failed'}
            onCheck={() => check.check(step)}
            onConfirm={() => onBlockAction({ type: 'step/confirm', step, at: new Date().toISOString() })}
            onGoToField={goToField}
            onSaveBackup={onSaveBackup}
            onOpenSettings={onOpenSettings}
          />
        ) : undefined
      }
      block={
        <BlockPanel
          project={project}
          step={step}
          onAction={onBlockAction}
          outlined={outlined}
          applied={applied}
          onShowProposals={(proposalId) => setJump((j) => ({ proposalId, n: (j?.n ?? 0) + 1 }))}
          liveIssues={!!check.runs[step]}
        />
      }
      chat={
        <Chat
          segments={state.segments}
          intro={stepIntro(step)}
          now={now}
          proposals={state.proposals}
          renderProposal={(proposal) => (
            <ProposalCard
              project={project}
              step={step}
              proposal={proposal}
              onAction={onBlockAction}
              onTarget={setOutlined}
              onApplied={(proposalId, changeIds) => setApplied((a) => ({ proposalId, changeIds, n: (a?.n ?? 0) + 1 }))}
              jump={jump?.proposalId === proposal.id ? jump.n : undefined}
              onJumped={clearJump}
            />
          )}
          run={chat.runs[step]}
          unanswered={unanswered(project, step)}
          draft={draft}
          onDraftChange={(text) => onDraftChange(step, text)}
          onSend={(text) => chat.send(step, text)}
          onStop={() => chat.stop(step)}
          onRetry={() => chat.retry(step)}
          onOpenSettings={onOpenSettings}
          model={model}
        />
      }
    />
  )
}

function headerFor(view: View): { title: string; meta?: string } {
  if (view.kind === 'home') return { title: 'Übersicht' }
  if (view.kind === 'settings') return { title: 'Einstellungen' }
  const step = steps[view.step]
  return { title: step.title, meta: `Schritt ${step.id} · ${step.part}` }
}
