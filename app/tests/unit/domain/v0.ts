import { makeProject } from '../../../src/domain/fixtures'
import type { Migrations, RawDocument } from '../../../src/domain/migrations'

// A made-up version 0, only to prove the migration framework (implementation plan step 5).
// v0 had no idCounters and called the privacy flag "privacySeen". No real document ever had
// this shape; the first real frozen fixture comes with the first real version bump.
export function v0Document(): RawDocument {
  const { idCounters: _, privacyNoteSeen, ...rest } = structuredClone(makeProject()) as RawDocument
  return { ...rest, schemaVersion: 0, privacySeen: privacyNoteSeen }
}

export const v0Migrations: Migrations = {
  0: ({ privacySeen, ...doc }) => ({ ...doc, schemaVersion: 1, privacyNoteSeen: privacySeen, idCounters: {} }),
}
