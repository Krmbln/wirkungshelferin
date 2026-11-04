import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProject } from '../../../src/domain/fixtures'
import { projectSchema } from '../../../src/domain/schemas/project'
import { findPreviousVersion, loadProject, loadProjectOnce, restorePreviousVersion } from '../../../src/storage/load'
import { idbStore, keys, memoryStore, requestPersistence, type Store } from '../../../src/storage/store'
import { v0Document, v0Migrations } from '../domain/v0'

beforeEach(() => {
  // A fresh, empty IndexedDB per test.
  globalThis.indexedDB = new IDBFactory()
})

describe('IndexedDB store', () => {
  it('keeps a document across a new connection (like a reload)', async () => {
    const p = makeProject()
    await idbStore().set(keys.project, p)
    expect(await idbStore().get(keys.project)).toEqual(p)
  })
})

describe('Load pipeline', () => {
  it('nothing stored → empty state', async () => {
    expect(await loadProject(idbStore())).toEqual({ kind: 'empty' })
  })

  it('a current document loads without being written', async () => {
    const p = makeProject()
    const store = memoryStore({ [keys.project]: p })
    const writes = spyWrites(store)
    expect(await loadProject(store)).toEqual({ kind: 'ready', project: p })
    expect(writes).toEqual([])
  })

  it('an invalid document stays exactly as it was', async () => {
    const broken = { ...makeProject(), steps: 'kaputt' }
    const store = idbStore()
    await store.set(keys.project, broken)
    expect(await loadProject(store)).toEqual({ kind: 'error', problem: 'invalid', raw: broken })
    expect(await store.get(keys.project)).toEqual(broken)
  })

  it('a document from a newer version stays exactly as it was', async () => {
    const newer = { ...makeProject(), schemaVersion: 2 }
    const store = memoryStore({ [keys.project]: newer })
    const writes = spyWrites(store)
    expect(await loadProject(store)).toMatchObject({ kind: 'error', problem: 'newer' })
    expect(writes).toEqual([])
    expect(store.data.get(keys.project)).toEqual(newer)
  })

  it('an older document is copied to project.pre-v0, then migrated and replaced', async () => {
    const raw = v0Document()
    const store = idbStore()
    await store.set(keys.project, raw)
    const result = await loadProject(store, v0Migrations)
    expect(result.kind).toBe('ready')
    expect(await store.get(keys.preMigration(0))).toEqual(raw)
    const stored = await store.get(keys.project)
    expect(projectSchema.safeParse(stored).success).toBe(true)
    expect(result.kind === 'ready' && result.project).toEqual(stored)
  })

  it('a migration that fails validation keeps the old document and writes nothing', async () => {
    const raw = v0Document()
    const store = memoryStore({ [keys.project]: raw })
    const writes = spyWrites(store)
    const lossy = { 0: (doc: Record<string, unknown>) => ({ ...doc, schemaVersion: 1 }) }
    expect(await loadProject(store, lossy)).toMatchObject({ kind: 'error', problem: 'invalid' })
    expect(writes).toEqual([])
    expect(store.data.get(keys.project)).toEqual(raw)
  })

  it('if the migrated document cannot be written, the old one stays (the copy is already safe)', async () => {
    const raw = v0Document()
    const store = memoryStore({ [keys.project]: raw })
    const set = store.set
    store.set = (key, value) => (key === keys.project ? Promise.reject(new Error('full')) : set(key, value))
    expect(await loadProject(store, v0Migrations)).toMatchObject({ kind: 'error', problem: 'storage' })
    expect(store.data.get(keys.project)).toEqual(raw)
    expect(store.data.get(keys.preMigration(0))).toEqual(raw)
  })

  it('runs once per store, however often it is asked (StrictMode)', async () => {
    const store = memoryStore({ [keys.project]: makeProject() })
    let reads = 0
    const get = store.get
    store.get = (key) => (reads++, get(key))
    await Promise.all([loadProjectOnce(store), loadProjectOnce(store)])
    expect(reads).toBe(1)
  })

  it('a storage that cannot be read → storage problem', async () => {
    const store: Store = { ...memoryStore(), get: () => Promise.reject(new Error('blocked')) }
    expect(await loadProject(store)).toEqual({ kind: 'error', problem: 'storage' })
  })
})

function spyWrites(store: Store): string[] {
  const writes: string[] = []
  const set = store.set.bind(store)
  store.set = async (key, value) => {
    writes.push(key)
    return set(key, value)
  }
  return writes
}

describe('Persistent storage', () => {
  const manager = (persisted: boolean, grant: boolean) =>
    ({ persisted: async () => persisted, persist: vi.fn(async () => grant) }) as unknown as StorageManager & {
      persist: ReturnType<typeof vi.fn>
    }

  it('asks Chrome when not yet persistent and reports the answer', async () => {
    const yes = manager(false, true)
    expect(await requestPersistence(yes)).toBe(true)
    expect(yes.persist).toHaveBeenCalledTimes(1)
    expect(await requestPersistence(manager(false, false))).toBe(false)
  })

  it('does not ask again when already persistent', async () => {
    const already = manager(true, true)
    expect(await requestPersistence(already)).toBe(true)
    expect(already.persist).not.toHaveBeenCalled()
  })

  it('without the API: undefined', async () => {
    expect(await requestPersistence({} as StorageManager)).toBeUndefined()
  })
})

describe('Previous version (undo a migration)', () => {
  it('finds the pre-migration copy only when there is one', async () => {
    expect(await findPreviousVersion(memoryStore({ [keys.project]: makeProject() }))).toBeUndefined()
    expect(await findPreviousVersion(memoryStore({ [keys.preMigration(0)]: v0Document() }))).toBe(0)
  })

  it('a store that cannot be read offers no restore', async () => {
    const store = memoryStore()
    store.get = () => Promise.reject(new Error('blocked'))
    expect(await findPreviousVersion(store)).toBeUndefined()
  })

  it('restoring puts the copy back as the project and keeps the copy', async () => {
    const raw = v0Document()
    const store = memoryStore({ [keys.project]: makeProject(), [keys.preMigration(0)]: raw })
    await restorePreviousVersion(store, 0)
    expect(store.data.get(keys.project)).toEqual(raw)
    expect(store.data.get(keys.preMigration(0))).toEqual(raw)
  })

  it('migrate → restore → the next start migrates the copy again', async () => {
    const raw = v0Document()
    const store = memoryStore({ [keys.project]: raw })
    const first = await loadProject(store, v0Migrations)
    await restorePreviousVersion(store, 0)
    expect(store.data.get(keys.project)).toEqual(raw)
    expect(await loadProject(store, v0Migrations)).toEqual(first)
  })

  it('a missing copy is refused and changes nothing', async () => {
    const p = makeProject()
    const store = memoryStore({ [keys.project]: p })
    await expect(restorePreviousVersion(store, 0)).rejects.toThrow()
    expect(store.data.get(keys.project)).toEqual(p)
  })
})
