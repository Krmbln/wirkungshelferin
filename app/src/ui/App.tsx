import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { panelGroupOf, panelKey } from '../domain/tree'
import { COVERAGE_KEY, initialClosed } from '../domain/plan'
import type { FieldTarget } from '../domain/check'
import { chatEmpty, reviewed, reviewPending, unanswered } from '../ai/chat'
import { earlierChanges } from '../domain/outdated'
import { backupState } from '../domain/backup'
import type { Action } from '../domain/reducer'
import type { Project } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import type { Drafts } from '../storage/drafts'
import { defaultSettings, type Settings as SettingsValue } from '../storage/settings'
import { stepIntro } from '../guide/intro'
import { BlockPanel, type Applied, type CollapsedChange } from './block/BlockPanel'
import { Chat } from './chat/Chat'
import { PDF_WAIT, usePdfImport, type PdfControls, type ReadPdf } from './chat/PdfImport'
import type { PasteDraft } from './chat/StartPanel'
import type { ChatControls } from './chat/useChatRunner'
import { fieldSelector } from './check/gate'
import { OutdatedBanner } from './check/OutdatedBanner'
import { QualityGate, type Handoff } from './check/QualityGate'
import type { CheckControls } from './check/useCheckRunner'
import { scrollIntoView } from './proposals/highlight'
import { Banner } from './components/Banner'
import { Button } from './components/Button'
import { CopyButton } from './copy/CopyButton'
import { copyStep, stepHasContent } from './copy/model'
import { Home } from './frame/Home'
import { ProposalCard, type TargetHint } from './proposals/ProposalCard'
import { PageHeader } from './frame/PageHeader'
import { Settings, type SettingsProps } from './frame/Settings'
import { Sidebar } from './frame/Sidebar'
import { StepWorkspace } from './frame/StepWorkspace'
import { statusesOf, steps, type View } from './steps'
import type { ResumeControls } from './useResumeRunner'
import { resumeDue } from '../domain/resume'
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
  /** Reads a PDF's text (Session: extractPdf); without it step 0 offers no PDF upload. */
  readPdf?: ReadPdf
  /** The home summary (Session's runner); the gallery passes a fixed state. */
  resume?: ResumeControls
  /** The step on screen, or undefined: Session counts changes there as Lukas's work. */
  onViewChange?: (step: StepId | undefined) => void
}

const noop = () => {}
const resolved = async () => {}
const connected = async () => ({ ok: true }) as const
const idleChat: ChatControls = { runs: {}, send: noop, act: noop, stop: noop, retry: noop }
const idleCheck: CheckControls = { runs: {}, check: async () => undefined }
const idleResume: ResumeControls = { write: noop }

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
  readPdf,
  resume = idleResume,
  onViewChange = noop,
}: Props) {
  const [view, setView] = useState<View>(initialView)
  const viewStep = view.kind === 'step' ? view.step : undefined
  useEffect(() => {
    onViewChange(viewStep)
  }, [viewStep, onViewChange])
  // The home summary is written once its step is off screen and nothing of it still runs, so it
  // includes the answer (design "Step 22"). Also at start: Lukas most often leaves by closing the tab.
  const due = resumeDue(project)
  const dueRun = due === undefined ? undefined : chat.runs[due]
  const dueBusy = (!!dueRun && dueRun.kind !== 'failed') || (due !== undefined && check.runs[due]?.kind === 'running')
  const { write: writeResume } = resume
  useEffect(() => {
    if (due !== undefined && due !== viewStep && !dueBusy) writeResume(due)
  }, [due, viewStep, dueBusy, writeResume, resume.writing])
  // Kept here, so a step switch doesn't lose a paste being prepared (design §6.2, step 14).
  const [paste, setPaste] = useState<PasteState>({ open: false, draft: { label: '', text: '' } })
  // Step 0's confirm started step 1's first draft in this session: step 0 shows the hand-off.
  const [handoffStarted, setHandoffStarted] = useState(false)
  // Collapsed groups of steps 2–4 (step 6: closed rows and coverage list): screen state, kept per step while the app is open.
  const [collapsed, setCollapsed] = useState<Partial<Record<StepId, string[]>>>({})
  // Step 6 starts with more than two rows closed (design "Step 20"); stored on first view, so rows added later start open.
  const step6Shown = view.kind === 'step' && view.step === 6
  useEffect(() => {
    if (step6Shown && !collapsed[6]) setCollapsed((c) => ({ ...c, 6: initialClosed(project) }))
  }, [step6Shown])
  // Here too, so a PDF being read survives a step switch (design §6.2, step 15).
  const pdf = usePdfImport(
    readPdf,
    {
      onText: (label, text) => chat.act(0, { kind: 'pdf', label, text }),
      onPartial: (label, text, note) => setPaste({ open: true, draft: { label, text, fromPdf: true }, note }),
    },
    !!chat.runs[0] && chat.runs[0].kind !== 'failed',
  )
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
            project={project}
            now={now}
            writing={resume.writing}
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
            paste={paste}
            onPasteChange={setPaste}
            pdf={pdf}
            handoffStarted={handoffStarted}
            onHandoffStarted={() => setHandoffStarted(true)}
            onOpenStep={(step) => setView({ kind: 'step', step })}
            collapsed={collapsed[view.step] ?? (view.step === 6 ? initialClosed(project) : [])}
            onCollapsedChange={(change) =>
              setCollapsed((c) => {
                const step = view.step
                const now = c[step] ?? (step === 6 ? initialClosed(project) : [])
                return { ...c, [step]: typeof change === 'function' ? change(now) : change }
              })
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
  paste: PasteState
  onPasteChange: (paste: PasteState) => void
  pdf?: PdfControls
  handoffStarted: boolean
  onHandoffStarted: () => void
  onOpenStep: (step: StepId) => void
  collapsed: string[]
  onCollapsedChange: (change: CollapsedChange) => void
}

type PasteState = { open: boolean; draft: PasteDraft; note?: string }

/** How step 1's first draft is doing, for step 0's hand-off banner. */
function handoffStatus(project: Project, chat: ChatControls): Handoff['status'] {
  const run = chat.runs[1]
  if (run?.kind === 'failed' || (!run && unanswered(project, 1))) return 'failed'
  if (!run && project.steps[1].segments.some((s) => s.messages.some((m) => m.role === 'assistant'))) return 'done'
  return 'writing'
}

/** "Zum Feld": scrolls the block column to the field and focuses it (design §6.2 state B). */
function focusField(target: Parameters<typeof fieldSelector>[0]) {
  const el = document.querySelector('.workspace__block')?.querySelector<HTMLElement>(fieldSelector(target))
  if (!el) return
  scrollIntoView(el)
  el.focus({ preventScroll: true })
}

// One step: chat and block, and what links them (outline, highlight, jump). Keyed by step,
// so that link state starts fresh on every step.
function StepView({
  project,
  step,
  now,
  chat,
  draft,
  onDraftChange,
  onBlockAction,
  onOpenSettings,
  model,
  check,
  onSaveBackup,
  paste,
  onPasteChange,
  pdf,
  handoffStarted,
  onHandoffStarted,
  onOpenStep,
  collapsed,
  onCollapsedChange,
}: StepViewProps) {
  const [outlined, setOutlined] = useState<TargetHint>()
  const [applied, setApplied] = useState<Applied>()
  const [jump, setJump] = useState<{ proposalId: string; n: number }>()
  const state = project.steps[step]
  const run = chat.runs[step]
  const chatBusy = !!run && run.kind !== 'failed'
  const changes = earlierChanges(project, step)
  const clearJump = useCallback(() => setJump(undefined), [])
  const openPaste = () => onPasteChange({ ...paste, open: true })
  // Confirming step 0 while step 1's chat is empty starts its first draft at once (PRD §3).
  const handoff: Handoff | undefined =
    step === 0 && (handoffStarted || chatEmpty(project, 1)) ? { status: handoffStatus(project, chat), onContinue: () => onOpenStep(1) } : undefined

  /** "Zum Feld" (or "Zu Schritt 1" when the fix lies there); a collapsed group opens first. */
  function goToField(target: FieldTarget) {
    if (target.step !== undefined && target.step !== step) return onOpenStep(target.step)
    const group =
      target.collection === 'coverage' ? COVERAGE_KEY : target.group ? panelKey(project, target.group) : target.id ? panelGroupOf(project, step, target.id) : undefined
    if (group && collapsed.includes(group)) flushSync(() => onCollapsedChange((keys) => keys.filter((k) => k !== group)))
    focusField(target)
  }

  function confirm() {
    const startDraft = step === 0 && chatEmpty(project, 1)
    onBlockAction({ type: 'step/confirm', step, at: new Date().toISOString() })
    if (!startDraft) return
    onHandoffStarted()
    chat.act(1, { kind: 'opening' })
  }

  return (
    <StepWorkspace
      step={steps[step]}
      copy={
        stepHasContent(project, step) && (
          <CopyButton build={() => copyStep(project, step)} label={`Baustein kopieren: Schritt ${step} · ${steps[step].title}`} data-copy="step">
            Kopieren
          </CopyButton>
        )
      }
      notice={
        changes.length > 0 && (
          <OutdatedBanner
            changes={changes}
            reviewed={reviewed(project, step)}
            running={chatBusy && (reviewPending(project, step) || (run.kind === 'summarising' && run.act?.kind === 'review'))}
            chatBusy={chatBusy}
            onReview={() => chat.act(step, { kind: 'review' })}
            onOpenStep={onOpenStep}
          />
        )
      }
      check={
        <QualityGate
          project={project}
          step={step}
          now={now}
          model={model}
          run={check.runs[step]}
          chatBusy={chatBusy}
          onCheck={() => check.check(step)}
          onConfirm={confirm}
          handoff={handoff}
          onGoToField={goToField}
          onSaveBackup={onSaveBackup}
          onOpenSettings={onOpenSettings}
        />
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
          onPaste={step === 0 ? openPaste : undefined}
          pdf={step === 0 ? pdf : undefined}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          onOpenStep={onOpenStep}
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
          stepLinks={{ step, onOpen: onOpenStep }}
          paste={
            step === 0
              ? {
                  ...paste,
                  wait: pdf?.state?.kind === 'reading' ? PDF_WAIT : undefined,
                  onOpen: openPaste,
                  onChange: (draft) => onPasteChange({ ...paste, draft }),
                  onCancel: () => onPasteChange({ ...paste, open: false }),
                  onSubmit: () => {
                    const { label, text, fromPdf } = paste.draft
                    chat.act(0, { kind: fromPdf ? 'pdf' : 'paste', label, text })
                    onPasteChange({ open: false, draft: { label: '', text: '' } })
                  },
                }
              : undefined
          }
          onInterview={step === 0 ? () => chat.act(0, { kind: 'interview' }) : undefined}
          pdf={step === 0 ? pdf : undefined}
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
