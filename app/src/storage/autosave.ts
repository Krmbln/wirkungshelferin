import type { Project } from '../domain/schemas/project'
import { keys, type Store } from './store'

export const AUTOSAVE_DELAY = 500
/** After a failed save, try again on its own, so the banner goes when storage recovers. */
export const RETRY_DELAY = 10_000

type Events = {
  onSaved: () => void
  onFailed: (error: unknown) => void
}

export type Autosave = {
  /** Remembers the latest document and saves it once changes pause for `delay` ms. */
  schedule: (project: Project) => void
  /** Saves the latest document after any running write ("Neu starten", backup loaded). */
  flush: () => Promise<void>
  /**
   * Tab hidden or closing: starts the write at once, without waiting for a running one.
   * IndexedDB runs write transactions on one store in the order they were created, so the
   * newer document still lands last.
   */
  flushNow: () => Promise<void>
  /** Stops the timers without saving. */
  dispose: () => void
}

// Debounced autosave (tech design §8). A burst of changes becomes one write, and an older
// document never lands after a newer one. Stream deltas never reach this: they stay in
// memory until the message completes (step 9).
export function createAutosave(store: Store, events: Events, delay = AUTOSAVE_DELAY): Autosave {
  let pending: Project | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> | undefined
  /** Number of the newest write started; an older write that fails is not retried. */
  let started = 0

  function stopTimer() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  async function write() {
    stopTimer()
    if (!pending) return
    const doc = pending
    pending = undefined
    const seq = ++started
    const run = store.set(keys.project, doc).then(events.onSaved, (error: unknown) => {
      if (seq === started) {
        // Keep it and try again later; the banner stays until a save works.
        pending ??= doc
        if (timer === undefined) timer = setTimeout(() => void flush(), RETRY_DELAY)
      }
      events.onFailed(error)
    })
    writing = run
    try {
      await run
    } finally {
      if (writing === run) writing = undefined
    }
  }

  async function flush() {
    stopTimer()
    while (writing) await writing
    await write()
  }

  return {
    schedule(project) {
      pending = project
      stopTimer()
      timer = setTimeout(() => void flush(), delay)
    },
    flush,
    flushNow: write,
    dispose: stopTimer,
  }
}
