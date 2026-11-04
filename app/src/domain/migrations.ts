import { SCHEMA_VERSION } from './schemas/project'

// Schema versions (tech design §8). migrations[n] turns a version-n document into version n+1.
// Empty while the schema is at version 1. From step 24 on, every version bump adds one entry
// here, a frozen fixture of the old version and a migration test (implementation plan rule 5).

export type RawDocument = Record<string, unknown>
export type Migration = (doc: RawDocument) => RawDocument
export type Migrations = Partial<Record<number, Migration>>

export const migrations: Migrations = {}

/** The document's schemaVersion, or undefined if it isn't a document at all. */
export function documentVersion(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const version = (raw as RawDocument).schemaVersion
  return Number.isInteger(version) && (version as number) >= 0 ? (version as number) : undefined
}

/** Runs every step from `from` up to the app's version on a copy. Throws if a step is missing. */
export function migrate(raw: RawDocument, from: number, table: Migrations = migrations): RawDocument {
  let doc = structuredClone(raw)
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = table[v]
    if (!step) throw new Error(`no migration from version ${v}`)
    doc = step(doc)
  }
  return doc
}
