import { stepIds, type StepId } from '../domain/types'
import { keys, type Store } from './store'

// The chat input per step survives errors, reloads and step switches (design §7.5). It lives
// under its own key: it isn't project content, never goes into a backup, and typing must not
// flash "Gespeichert".

export type Drafts = Partial<Record<StepId, string>>

export async function loadDrafts(store: Store): Promise<Drafts> {
  try {
    const raw = await store.get(keys.drafts)
    if (!raw || typeof raw !== 'object') return {}
    const drafts: Drafts = {}
    for (const step of stepIds) {
      const text = (raw as Record<string, unknown>)[step]
      if (typeof text === 'string' && text) drafts[step] = text
    }
    return drafts
  } catch (error) {
    console.error('Drafts could not be read', error)
    return {}
  }
}

/**
 * Written on every change, not debounced: Chrome drops IndexedDB writes that start while the
 * page unloads, so a write saved for "pagehide" would lose what was typed just before a reload.
 * Writes to one store run in the order they were started. A failure only logs: the text is
 * still on screen.
 */
export function saveDrafts(store: Store, drafts: Drafts): Promise<void> {
  return store.set(keys.drafts, drafts).catch((error) => console.error('Draft save failed', error))
}
