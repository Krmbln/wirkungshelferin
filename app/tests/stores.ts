import { defaultSettings } from '../src/storage/settings'
import { keys, memoryStore } from '../src/storage/store'

/** An in-memory store of a Chrome where setup already ran (step 7), so tests start on the app. */
export function readyStore(initial: Record<string, unknown> = {}) {
  return memoryStore({ [keys.settings]: { ...defaultSettings, setupDone: true }, ...initial })
}
