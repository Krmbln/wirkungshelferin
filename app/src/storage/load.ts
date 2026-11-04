import { parseDocument, type DocumentProblem } from '../domain/document'
import { documentVersion, migrations, type Migrations } from '../domain/migrations'
import { SCHEMA_VERSION, type Project } from '../domain/schemas/project'
import { keys, type Store } from './store'

export type LoadProblem = DocumentProblem | 'storage'
export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'ready'; project: Project }
  /** raw = the stored document, untouched, so it can still be saved as a file. */
  | { kind: 'error'; problem: LoadProblem; raw?: unknown }

// Load pipeline on every app start (tech design §8): read → copy an older document to
// project.pre-v{n} → migrate → validate → only then replace. On any failure the stored
// document stays exactly as it was.
export async function loadProject(store: Store, table: Migrations = migrations): Promise<LoadResult> {
  let raw: unknown
  try {
    raw = await store.get(keys.project)
  } catch {
    return { kind: 'error', problem: 'storage' }
  }
  if (raw === undefined) return { kind: 'empty' }

  const version = documentVersion(raw)
  const parsed = parseDocument(raw, table)
  if (!parsed.ok) return { kind: 'error', problem: parsed.problem, raw }
  if (version !== undefined && version < SCHEMA_VERSION) {
    try {
      await store.set(keys.preMigration(version), raw)
      await store.set(keys.project, parsed.project)
    } catch {
      return { kind: 'error', problem: 'storage', raw }
    }
  }
  return { kind: 'ready', project: parsed.project }
}

/**
 * The version of the newest pre-migration copy, if any (tech design §8). Settings offers
 * "Vorherige Version wiederherstellen" only then.
 */
export async function findPreviousVersion(store: Store): Promise<number | undefined> {
  for (let v = SCHEMA_VERSION - 1; v >= 0; v--) {
    try {
      if ((await store.get(keys.preMigration(v))) !== undefined) return v
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Puts the pre-migration copy back as the project. The page then reloads, so the load
 * pipeline migrates it again with the app's current migrations (a fixed one, typically).
 * The copy itself stays.
 */
export async function restorePreviousVersion(store: Store, version: number): Promise<void> {
  const raw = await store.get(keys.preMigration(version))
  if (raw === undefined) throw new Error(`no copy from version ${version}`)
  await store.set(keys.project, raw)
}

const loads = new WeakMap<Store, Promise<LoadResult>>()

/**
 * The pipeline once per store and page. StrictMode runs effects twice in dev; two runs at
 * once would both write the pre-migration copy and the migrated document.
 */
export function loadProjectOnce(store: Store): Promise<LoadResult> {
  let load = loads.get(store)
  if (!load) {
    load = loadProject(store)
    loads.set(store, load)
  }
  return load
}
