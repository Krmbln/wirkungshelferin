import { emptyBlock } from './schemas/blocks'
import { SCHEMA_VERSION, projectSchema, type Project } from './schemas/project'
import { documentVersion, migrate, migrations, type Migrations, type RawDocument } from './migrations'
import { stepIds } from './types'

/** A fresh project for "Neu starten": every step empty and not started. */
export function newProject(at: string): Project {
  const steps = Object.fromEntries(
    stepIds.map((s) => [s, { status: 'not_started', block: emptyBlock(s), segments: [], proposals: [], confirmedWarnings: [] }]),
  )
  return projectSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    privacyNoteSeen: false,
    steps,
    idCounters: {},
  })
}

export type DocumentProblem = 'invalid' | 'newer'
export type Parsed = { ok: true; project: Project; from: number } | { ok: false; problem: DocumentProblem }

/**
 * Migrate, then validate (tech design §8). No I/O, so app start and backup files share it.
 * Nothing is returned unless the whole document passes.
 */
export function parseDocument(raw: unknown, table: Migrations = migrations): Parsed {
  const from = documentVersion(raw)
  if (from === undefined) return { ok: false, problem: 'invalid' }
  if (from > SCHEMA_VERSION) return { ok: false, problem: 'newer' }
  let doc: RawDocument
  try {
    doc = migrate(raw as RawDocument, from, table)
  } catch {
    return { ok: false, problem: 'invalid' }
  }
  const result = projectSchema.safeParse(doc)
  return result.success ? { ok: true, project: result.data, from } : { ok: false, problem: 'invalid' }
}
