import { useCallback, useEffect, useMemo, useState } from 'react'
import { newProject } from '../domain/document'
import type { Project } from '../domain/schemas/project'
import { createAutosave } from '../storage/autosave'
import { backupProblemText, downloadBackup, readBackupFile } from '../storage/backup'
import { loadProjectOnce, type LoadProblem } from '../storage/load'
import { requestPersistence, type Store } from '../storage/store'
import { holdTabLock } from '../storage/tabLock'
import { App } from './App'
import { EmptyState } from './screens/EmptyState'
import { LoadError } from './screens/LoadError'
import { SecondTab } from './screens/SecondTab'
import { Skeleton } from './screens/Skeleton'

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
}

/** When a refused tab asks again after Lukas comes back to it. */
export const RETRY_AFTER_RETURN_MS = [0, 250, 500, 1000, 2000, 3000]

// Owns the stored project: tab lock → load pipeline → app, plus autosave (tech design §8).
export function Session({ store, locks = navigator.locks }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [savedAt, setSavedAt] = useState<number>()
  const [saveFailed, setSaveFailed] = useState(false)

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
        void requestPersistence().catch(() => undefined)
        const result = await loadProjectOnce(store)
        if (!live) return
        if (result.kind === 'error') setPhase(result)
        else setPhase({ kind: 'ready', project: result.kind === 'ready' ? result.project : null })
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
      setPhase({ kind: 'ready', project })
      autosave.schedule(project)
    },
    [autosave],
  )

  // Starting or loading a project is a deliberate act: saved at once, not after the pause.
  const start = useCallback(
    async (project: Project) => {
      update(project)
      await autosave.flush()
    },
    [update, autosave],
  )

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
  return <App project={project} savedAt={savedAt} saveFailed={saveFailed} onSaveBackup={() => downloadBackup(project)} />
}
