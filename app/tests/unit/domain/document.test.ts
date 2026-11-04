import { describe, expect, it } from 'vitest'
import { newProject, parseDocument } from '../../../src/domain/document'
import { makeProject } from '../../../src/domain/fixtures'
import { migrate, type Migrations } from '../../../src/domain/migrations'
import { projectSchema } from '../../../src/domain/schemas/project'
import { stepIds } from '../../../src/domain/types'
import { v0Document, v0Migrations } from './v0'

describe('Documents: new project', () => {
  it('"Neu starten" makes a valid project with every step empty and not started', () => {
    const p = newProject('2026-11-04T09:00:00.000Z')
    expect(projectSchema.safeParse(p).success).toBe(true)
    expect(stepIds.map((s) => p.steps[s].status)).toEqual(Array(7).fill('not_started'))
    expect(p.createdAt).toBe('2026-11-04T09:00:00.000Z')
    expect(p.privacyNoteSeen).toBe(false)
  })
})

describe('Documents: migrate → validate', () => {
  it('accepts a current document as it is', () => {
    const p = makeProject()
    expect(parseDocument(p)).toEqual({ ok: true, project: p, from: 1 })
  })

  it('migrates the v0 fixture to a valid current document', () => {
    const parsed = parseDocument(v0Document(), v0Migrations)
    expect(parsed.ok && parsed.from).toBe(0)
    expect(parsed.ok && projectSchema.safeParse(parsed.project).success).toBe(true)
  })

  it('never changes the document it migrates', () => {
    const raw = v0Document()
    const before = structuredClone(raw)
    migrate(raw, 0, v0Migrations)
    expect(raw).toEqual(before)
  })

  it('refuses an old version without a migration step (none ship while the schema is at 1)', () => {
    expect(parseDocument(v0Document())).toEqual({ ok: false, problem: 'invalid' })
  })

  it('refuses a migration that throws or produces an invalid document', () => {
    const throwing: Migrations = { 0: () => { throw new Error('boom') } }
    const lossy: Migrations = { 0: (doc) => ({ ...doc, schemaVersion: 1 }) }
    expect(parseDocument(v0Document(), throwing)).toEqual({ ok: false, problem: 'invalid' })
    expect(parseDocument(v0Document(), lossy)).toEqual({ ok: false, problem: 'invalid' })
  })

  it('refuses a newer version', () => {
    expect(parseDocument({ ...makeProject(), schemaVersion: 2 })).toEqual({ ok: false, problem: 'newer' })
  })

  it('refuses things that are not documents', () => {
    for (const raw of [null, 'text', 42, [], {}, { schemaVersion: '1' }, { schemaVersion: -1 }, { schemaVersion: 1.5 }]) {
      expect(parseDocument(raw).ok).toBe(false)
    }
  })
})
