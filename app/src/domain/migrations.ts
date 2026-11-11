import { SCHEMA_VERSION } from './schemas/project'
import { stepIds, type StepId } from './types'

// Schema versions (tech design §8). migrations[n] turns a version-n document into version n+1.
// Empty while the schema is at version 1. Since step 24 every version bump adds one entry here,
// a frozen fixture of the new version (tests/fixtures/schema/) and a test of what the migration
// keeps; tests/unit/domain/frozen.test.ts refuses a bump without them (implementation plan rule 5).

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

/**
 * Runs a block migration over every stored copy of a step's block: the block, its confirmed
 * snapshot, its quality check's block, the last sent block, and the snapshots of earlier steps
 * that an outdated step keeps (outdatedBy, keyed by the earlier step). A migration that changes a
 * block's shape goes through here, so no copy stays in the old shape. Proposal changes and stored
 * tool calls hold item fields too; a migration that renames a field checks those as well.
 */
export function mapBlocks(doc: RawDocument, fn: (block: RawDocument, step: StepId) => RawDocument): RawDocument {
  const next = structuredClone(doc)
  const steps = next.steps as Record<string, Record<string, unknown>>
  const holder = (value: unknown) => value as { block: RawDocument } | undefined
  for (const step of stepIds) {
    const state = steps[step]
    state.block = fn(state.block as RawDocument, step)
    for (const copy of [holder(state.confirmed), holder(state.qualityCheck)]) if (copy) copy.block = fn(copy.block, step)
    if (state.sentBlock) state.sentBlock = fn(state.sentBlock as RawDocument, step)
    for (const [earlier, snapshot] of Object.entries((state.outdatedBy ?? {}) as Record<string, { block: RawDocument }>))
      snapshot.block = fn(snapshot.block, Number(earlier) as StepId)
  }
  return next
}
