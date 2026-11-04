import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProject } from '../../../src/domain/fixtures'
import type { Project } from '../../../src/domain/schemas/project'
import { AUTOSAVE_DELAY, RETRY_DELAY, createAutosave } from '../../../src/storage/autosave'
import { keys, type Store } from '../../../src/storage/store'

const version = (n: number): Project => ({ ...makeProject(), updatedAt: `2026-11-04T10:00:${String(n).padStart(2, '0')}.000Z` })

/** Records every write; `fail` makes the next writes reject, `slow` holds them until released. */
function recordingStore() {
  const writes: Project[] = []
  const state = { fail: false, slow: false, calls: 0 }
  const held: (() => void)[] = []
  const store: Store = {
    get: async () => undefined,
    del: async () => {},
    set: async (key, value) => {
      expect(key).toBe(keys.project)
      state.calls++
      if (state.slow) await new Promise<void>((resolve) => held.push(resolve))
      if (state.fail) throw new Error('QuotaExceededError')
      writes.push(value as Project)
    },
  }
  return { store, writes, state, release: () => held.splice(0).forEach((r) => r()) }
}

function setup() {
  const rec = recordingStore()
  const events = { onSaved: vi.fn(), onFailed: vi.fn() }
  const autosave = createAutosave(rec.store, events)
  return { ...rec, events, autosave }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Autosave', () => {
  it(`writes ${AUTOSAVE_DELAY} ms after the last change, not before`, async () => {
    const { autosave, writes } = setup()
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 1)
    expect(writes).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual([version(1)])
  })

  it('a burst of 50 changes (like stream deltas) becomes one write of the latest', async () => {
    const { autosave, writes, events } = setup()
    for (let i = 0; i < 50; i++) {
      autosave.schedule(version(i))
      await vi.advanceTimersByTimeAsync(20)
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(writes).toEqual([version(49)])
    expect(events.onSaved).toHaveBeenCalledTimes(1)
  })

  it('flush writes at once (tab hidden or closing) and cancels the timer', async () => {
    const { autosave, writes } = setup()
    autosave.schedule(version(1))
    await autosave.flush()
    expect(writes).toEqual([version(1)])
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY * 2)
    expect(writes).toHaveLength(1)
  })

  it('flush with nothing pending writes nothing', async () => {
    const { autosave, writes } = setup()
    await autosave.flush()
    expect(writes).toEqual([])
  })

  it('one write at a time: a newer document never lands before an older one', async () => {
    const { autosave, writes, state, release } = setup()
    state.slow = true
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    autosave.schedule(version(2))
    const second = autosave.flush()
    state.slow = false
    release()
    await second
    expect(writes).toEqual([version(1), version(2)])
  })

  it('a failed save reports it and keeps the document, so the next try saves it', async () => {
    const { autosave, writes, state, events } = setup()
    state.fail = true
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(events.onFailed).toHaveBeenCalledTimes(1)
    expect(events.onSaved).not.toHaveBeenCalled()

    state.fail = false
    await autosave.flush()
    expect(writes).toEqual([version(1)])
    expect(events.onSaved).toHaveBeenCalledTimes(1)
  })

  it('a failed save tries again on its own, so the banner goes when storage recovers', async () => {
    const { autosave, writes, state, events } = setup()
    state.fail = true
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(events.onFailed).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY)
    expect(events.onFailed).toHaveBeenCalledTimes(2)
    state.fail = false
    await vi.advanceTimersByTimeAsync(RETRY_DELAY)
    expect(writes).toEqual([version(1)])
    expect(events.onSaved).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RETRY_DELAY * 3)
    expect(writes).toHaveLength(1)
  })

  it('flushNow starts at once, without waiting for a running write', async () => {
    const { autosave, writes, state, release } = setup()
    state.slow = true
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    autosave.schedule(version(2))
    const now = autosave.flushNow()
    await vi.advanceTimersByTimeAsync(0)
    // Both writes are running; the store (IndexedDB) keeps them in order.
    expect(state.calls).toBe(2)
    state.slow = false
    release()
    await now
    expect(writes).toHaveLength(2)
  })

  it('an older write that fails is not retried over a newer one', async () => {
    const { autosave, writes, state, release } = setup()
    state.slow = true
    state.fail = true
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    autosave.schedule(version(2))
    const now = autosave.flushNow()
    await vi.advanceTimersByTimeAsync(0)
    state.slow = false
    release()
    await now
    state.fail = false
    await autosave.flush()
    await vi.advanceTimersByTimeAsync(RETRY_DELAY)
    expect(writes).toEqual([version(2)])
  })

  it('after a failure, a newer change wins over the failed document', async () => {
    const { autosave, writes, state } = setup()
    state.fail = true
    autosave.schedule(version(1))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    state.fail = false
    autosave.schedule(version(2))
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY)
    expect(writes).toEqual([version(2)])
  })
})
