import { createStore, del, get, set } from 'idb-keyval'

// IndexedDB adapter (tech design §8). The project document and settings live under
// separate keys, so a backup never carries the settings (and with them the API key).

export const keys = {
  project: 'project',
  settings: 'settings',
  /** The raw document as it was before a migration from version n. */
  preMigration: (version: number) => `project.pre-v${version}`,
}

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
}

export function idbStore(dbName = 'wirkungshelferin'): Store {
  const db = createStore(dbName, 'data')
  return {
    get: (key) => get(key, db),
    set: (key, value) => set(key, value, db),
    del: (key) => del(key, db),
  }
}

/** In memory, for tests and the gallery. Values are cloned like IndexedDB does. */
export function memoryStore(initial: Record<string, unknown> = {}): Store & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => void data.set(key, structuredClone(value)),
    del: async (key) => void data.delete(key),
  }
}

/** Asks Chrome not to clear our data under storage pressure. undefined = API missing. */
export async function requestPersistence(storage: StorageManager | undefined = navigator.storage): Promise<boolean | undefined> {
  if (!storage?.persist) return undefined
  if (await storage.persisted()) return true
  return storage.persist()
}
