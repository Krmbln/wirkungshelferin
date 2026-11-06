import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sdkAiClient, type AiClient } from '../ai/client'
import { withBackupTime } from '../domain/backup'
import { newProject } from '../domain/document'
import type { Project } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { createAutosave } from '../storage/autosave'
import { backupProblemText, downloadBackup, readBackupFile } from '../storage/backup'
import { loadDrafts, saveDrafts, type Drafts } from '../storage/drafts'
import { findPreviousVersion, loadProjectOnce, restorePreviousVersion, type LoadProblem } from '../storage/load'
import { defaultSettings, loadSettings, saveSettings, type Settings } from '../storage/settings'
import { requestPersistence, type Store } from '../storage/store'
import { holdTabLock } from '../storage/tabLock'
import { App } from './App'
import { useChatRunner, type DraftKeeper } from './chat/useChatRunner'
import { EmptyState } from './screens/EmptyState'
import { LoadError } from './screens/LoadError'
import { SecondTab } from './screens/SecondTab'
import { Skeleton } from './screens/Skeleton'
import { Setup } from './setup/Setup'

type Phase =
  | { kind: 'starting' }
  | { kind: 'second-tab' }
  | { kind: 'error'; problem: LoadProblem; raw?: unknown }
  /** project null = empty state. */
  | { kind: 'ready'; project: Project | null }

type Props = {
  store: Store
  /** Tests pass a fake; the app uses Chrome's. */
  locks?: LockManager
  reload?: () => void
  /** Tests pass the scripted mock; the app talks to the API. */
  ai?: AiClient
}

let defaultAi: AiClient | undefined

/** When a refused tab asks again after Lukas comes back to it. */
export const RETRY_AFTER_RETURN_MS = [0, 250, 500, 1000, 2000, 3000]

// Owns the stored project: tab lock → load pipeline → app, plus autosave (tech design §8).
export function Session({ store, locks = navigator.locks, reload = () => window.location.reload(), ai = (defaultAi ??= sdkAiClient()) }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [persisted, setPersisted] = useState<boolean>()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [previousVersion, setPreviousVersion] = useState<number>()
  const [savedAt, setSavedAt] = useState<number>()
  const [saveFailed, setSaveFailed] = useState(false)
  const [drafts, setDrafts] = useState<Drafts>({})
  /** The newest project, for changes that land later (a streamed answer). */
  const current = useRef<Project | null>(null)
  if (phase.kind === 'ready') current.current = phase.project

  const autosave = useMemo(
    () =>
      createAutosave(store, {
        onSaved: () => {
          setSavedAt(Date.now())
          setSaveFailed(false)
        },
        onFailed: (error) => {
          console.error('Autosave failed', error)
          setSaveFailed(true)
        },
      }),
    [store],
  )

  useEffect(() => {
    let live = true
    let entering = false
    let entered = false

    async function enter() {
      if (entering || entered) return
      entering = true
      try {
        if (!(await holdTabLock(locks))) {
          if (live) setPhase({ kind: 'second-tab' })
          return
        }
        // From here on this tab owns the data; coming back to it must not load again.
        entered = true
        stopListening()
        // Shown on the setup's backup screen (PRD F1).
        void requestPersistence().then(
          (granted) => live && setPersisted(granted),
          () => undefined,
        )
        const result = await loadProjectOnce(store)
        if (!live) return
        // Settings live under their own key and never block the start. Loaded on the error
        // path too: continuing with a backup from there must not reset key and setup.
        const [stored, previous, savedDrafts] = await Promise.all([loadSettings(store), findPreviousVersion(store), loadDrafts(store)])
        if (!live) return
        setSettings(stored)
        setPreviousVersion(previous)
        drafted.current = savedDrafts
        setDrafts(savedDrafts)
        setPhase(result.kind === 'error' ? result : { kind: 'ready', project: result.kind === 'ready' ? result.project : null })
      } finally {
        entering = false
      }
    }

    // A refused tab asks again when Lukas comes back to it, e.g. after closing the other one.
    // Closing a tab shows its neighbour at once, but the closing page releases the lock a
    // moment later, so one try right away isn't enough: try a few times over ~3 s.
    let retries: ReturnType<typeof setTimeout>[] = []
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      retries.forEach(clearTimeout)
      retries = RETRY_AFTER_RETURN_MS.map((ms) => setTimeout(() => void enter(), ms))
    }
    function stopListening() {
      retries.forEach(clearTimeout)
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('pointerdown', onReturn)
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    // Clicking into a tab that is already shown fires neither event above.
    document.addEventListener('pointerdown', onReturn)
    void enter()
    return () => {
      live = false
      stopListening()
    }
  }, [store, locks])

  // Save right away when the tab is hidden, closed or the session ends.
  useEffect(() => {
    const flush = () => void autosave.flushNow()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [autosave])

  /** Every project change goes through here, so it is always saved. */
  const update = useCallback(
    (project: Project) => {
      current.current = project
      setPhase({ kind: 'ready', project })
      autosave.schedule(project)
    },
    [autosave],
  )

  /**
   * A change computed from the newest project, e.g. an answer that arrives after other edits.
   * `now`: saved at once instead of after the pause. Chrome drops writes that start while the
   * page unloads, so a chat turn must not wait for the unload flush (lessons-learned, step 9).
   */
  const change = useCallback(
    (fn: (project: Project) => Project, { now = false }: { now?: boolean } = {}) => {
      if (!current.current) return
      update(fn(current.current))
      if (now) void autosave.flush()
    },
    [update, autosave],
  )

  const drafted = useRef<Drafts>({})
  const changeDraft = useCallback(
    (step: StepId, text: string) => {
      const next = { ...drafted.current, [step]: text }
      if (!text) delete next[step]
      drafted.current = next
      setDrafts(next)
      void saveDrafts(store, next)
    },
    [store],
  )

  // Lukas's text is safe while a summary runs before his turn is stored (useChatRunner).
  const draftKeeper = useMemo<DraftKeeper>(
    () => ({
      hold: (step, text) => void saveDrafts(store, { ...drafted.current, [step]: text }),
      release: () => void saveDrafts(store, drafted.current),
      restore: (step, text) => {
        const typed = drafted.current[step]
        changeDraft(step, typed ? `${text}\n${typed}` : text)
      },
    }),
    [store, changeDraft],
  )
  const readProject = useCallback(() => current.current, [])
  const chat = useChatRunner({ ai, settings, project: readProject, change, drafts: draftKeeper })

  // Starting or loading a project is a deliberate act: saved at once, not after the pause.
  const start = useCallback(
    async (project: Project) => {
      update(project)
      await autosave.flush()
    },
    [update, autosave],
  )

  // The file carries its own backup time, so after loading it the sidebar is right too.
  const saveBackup = useCallback(
    (project: Project) => {
      const at = new Date()
      const next = withBackupTime(project, at)
      update(next)
      downloadBackup(next, at)
    },
    [update],
  )

  const changeSettings = useCallback(
    async (next: Settings) => {
      await saveSettings(store, next)
      setSettings(next)
      setSavedAt(Date.now())
    },
    [store],
  )

  // Saves what is pending first (so a failed restore loses nothing), then stops autosave
  // for good: the reload's unload flush must not write the current document back.
  const restorePrevious = useCallback(async () => {
    if (previousVersion === undefined) return
    await autosave.flush()
    autosave.stop()
    try {
      await restorePreviousVersion(store, previousVersion)
    } catch (error) {
      console.error('Restore failed', error)
    }
    reload()
  }, [autosave, store, previousVersion, reload])

  if (phase.kind === 'starting') return <Skeleton />
  if (phase.kind === 'second-tab') return <SecondTab />
  if (phase.kind === 'error') return <LoadError problem={phase.problem} raw={phase.raw} onUseBackup={start} />
  if (!phase.project) {
    return (
      <EmptyState
        onNew={() => start(newProject(new Date().toISOString()))}
        onLoadBackup={async (file) => {
          const parsed = await readBackupFile(file)
          if (!parsed.ok) return backupProblemText[parsed.problem]
          await start(parsed.project)
          return null
        }}
      />
    )
  }
  const project = phase.project
  // Once per Chrome (PO decision 2026-11-04); the key never travels with a backup.
  if (!settings.setupDone) {
    return (
      <Setup
        project={project}
        settings={settings}
        persisted={persisted}
        onSettingsChange={changeSettings}
        testConnection={ai.testConnection}
        onPrivacySeen={() => update({ ...project, privacyNoteSeen: true })}
        onSaveBackup={() => saveBackup(project)}
      />
    )
  }
  return (
    <App
      project={project}
      savedAt={savedAt}
      saveFailed={saveFailed}
      onSaveBackup={() => saveBackup(project)}
      settings={settings}
      onSettingsChange={changeSettings}
      onReplaceProject={start}
      previousVersion={previousVersion}
      onRestorePrevious={restorePrevious}
      testConnection={ai.testConnection}
      chat={chat}
      drafts={drafts}
      onDraftChange={changeDraft}
    />
  )
}
