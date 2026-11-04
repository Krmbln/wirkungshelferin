import { z } from '../domain/schemas/zod'
import { keys, type Store } from './store'

// Settings (tech design §6.1, §7): a separate IndexedDB key, never in the project document,
// so they never reach a backup file. That is what keeps the API key out of backups.

export const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof efforts)[number]

export const DEFAULT_MODEL = 'claude-opus-5-5'
export const DEFAULT_EFFORT: Effort = 'medium'

export const settingsSchema = z.strictObject({
  apiKey: z.string().min(1).optional(),
  model: z.string().trim().min(1),
  effort: z.enum(efforts),
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT }

/** Missing or unusable settings fall back to the defaults; the stored value stays until a change. */
export async function loadSettings(store: Store): Promise<Settings> {
  let raw: unknown
  try {
    raw = await store.get(keys.settings)
  } catch {
    return defaultSettings
  }
  const parsed = settingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : defaultSettings
}

export async function saveSettings(store: Store, settings: Settings): Promise<void> {
  await store.set(keys.settings, settingsSchema.parse(settings))
}

/** Only the last four characters, so the key can be recognised but not read off the screen. */
export function maskKey(key: string): string {
  return `••••••••${key.slice(-4)}`
}

/** Why a typed key can't be right, or null. The connection test (step 7) has the last word. */
export function keyProblem(key: string): string | null {
  if (key === '') return 'Füg hier deinen API-Schlüssel ein.'
  if (/\s/.test(key) || key.length < 20)
    return 'Das sieht nicht wie ein vollständiger API-Schlüssel aus. Kopier ihn noch einmal ganz.'
  return null
}
