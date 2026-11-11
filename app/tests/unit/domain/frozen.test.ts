// @vitest-environment node
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDocument } from '../../../src/domain/document'
import { mapBlocks, migrations, type RawDocument } from '../../../src/domain/migrations'
import { SCHEMA_VERSION, projectSchema } from '../../../src/domain/schemas/project'
import { z } from '../../../src/domain/schemas/zod'
import { stepIds, type StepId } from '../../../src/domain/types'

// Frozen documents (implementation plan rule 5, since step 24 = first release with real data):
// one per schema version, written once by the app of that version and never edited again.
// v1.json came from the real chat pipeline (recorded step 6 opening, a card half applied, a second
// segment with a summary, step 2 re-confirmed so steps 3–5 keep its old snapshot). Made-up content.
//
// A version bump to N: add migrations[N-1], freeze vN.json from the new app, add its hash here,
// update SCHEMA_SHAPE, and write migration-v{N-1}.test.ts: what migrations[N-1] keeps on
// v(N-1).json. The file hash stops anyone from "fixing" an old fixture after a schema change; the
// shape hash stops a schema change (even an added optional field) without a version bump.
const FROZEN: Record<number, string> = {
  1: '22d610ab1de018f1d5ae59d40f6227b077b572dbba5954c38c347bd5fe2e542e',
}

/** sha256 of the current schema's JSON Schema: the shape every stored document of this version has. */
const SCHEMA_SHAPE = 'fed6be7090894d028f642269a6b86d2d8f22888243c495612b98eada1d4046ff'

const dir = new URL('../../fixtures/schema/', import.meta.url)
const files = readdirSync(dir).filter((f) => /^v\d+\.json$/.test(f))
const versionOf = (file: string) => Number(file.slice(1, -'.json'.length))
const text = (file: string) => readFileSync(new URL(file, dir), 'utf8')
const raw = (file: string) => JSON.parse(text(file)) as RawDocument
const versions = Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1)

describe('frozen documents', () => {
  it('exist for every version up to the current one, each with its hash and a migration onwards', () => {
    expect(files.map(versionOf).sort((a, b) => a - b)).toEqual(versions)
    expect(Object.keys(FROZEN).map(Number)).toEqual(versions)
    for (const v of versions.slice(0, -1)) expect(migrations[v], `migrations[${v}]`).toBeTypeOf('function')
  })

  it('the schema has the shape the current version was frozen with', () => {
    const shape = JSON.stringify(z.toJSONSchema(projectSchema, { unrepresentable: 'any', io: 'input' }))
    const hash = createHash('sha256').update(shape).digest('hex')
    expect(hash, 'The project schema changed without a version bump: real documents of this version may lack or hold other fields. Bump SCHEMA_VERSION (see the steps above).').toBe(SCHEMA_SHAPE)
  })

  it('every migration has its own test of what it keeps', () => {
    for (const v of versions.slice(0, -1)) expect(existsSync(new URL(`migration-v${v}.test.ts`, import.meta.url)), `migration-v${v}.test.ts`).toBe(true)
  })

  it.each(files)('%s is unchanged since it was frozen', (file) => {
    expect(createHash('sha256').update(text(file)).digest('hex')).toBe(FROZEN[versionOf(file)])
  })

  it.each(files)('%s loads in the current app', (file) => {
    const parsed = parseDocument(raw(file))
    expect(parsed).toMatchObject({ ok: true, from: versionOf(file) })
  })

  it('the current version loads without losing a field', () => {
    // The schema's objects are strict, so a renamed or dropped field fails the load; this also catches
    // a value the schema now rewrites (a default, a transform) without a version bump.
    const doc = raw(`v${SCHEMA_VERSION}.json`)
    const parsed = parseDocument(doc)
    if (!parsed.ok) throw new Error(parsed.problem)
    expect(JSON.parse(JSON.stringify(parsed.project))).toEqual(doc)
  })

  it('v1 holds every shape a migration has to carry', () => {
    const steps = raw('v1.json').steps as Record<string, Record<string, unknown>>
    const all = Object.values(steps)
    expect(all.filter((s) => s.outdatedBy).length).toBeGreaterThan(0)
    expect(all.filter((s) => s.confirmed).length).toBeGreaterThan(0)
    expect(all.filter((s) => s.qualityCheck).length).toBeGreaterThan(0)
    expect(all.filter((s) => s.sentBlock).length).toBeGreaterThan(0)
    expect(all.filter((s) => s.resume).length).toBeGreaterThan(0)
    const changes = all.flatMap((s) => (s.proposals as { changes: { state: string; undo?: unknown }[] }[]).flatMap((p) => p.changes))
    expect(new Set(changes.map((c) => c.state))).toEqual(new Set(['open', 'applied', 'rejected']))
    expect(changes.some((c) => c.undo)).toBe(true)
    const segments = all.flatMap((s) => s.segments as { summaryOfPrevious?: string; messages: { content: { type: string }[] }[] }[])
    expect(segments.some((s) => s.summaryOfPrevious)).toBe(true)
    const types = new Set(segments.flatMap((s) => s.messages.flatMap((m) => m.content.map((b) => b.type))))
    for (const type of ['text', 'thinking', 'tool_use']) expect(types).toContain(type)
  })
})

describe('mapBlocks', () => {
  it('reaches every stored copy of a block, with the step the block belongs to', () => {
    const doc = raw('v1.json')
    const seen: StepId[] = []
    mapBlocks(doc, (block, step) => {
      seen.push(step)
      return block
    })
    const steps = doc.steps as Record<string, Record<string, unknown>>
    const expected = stepIds.flatMap((step) => {
      const s = steps[step]
      const own = [s.block, s.confirmed, s.qualityCheck, s.sentBlock].filter(Boolean).map(() => step)
      return [...own, ...Object.keys(s.outdatedBy ?? {}).map((e) => Number(e) as StepId)]
    })
    expect(seen.sort()).toEqual(expected.sort())
  })

  it('a block change reaches the outdated steps’ snapshots, and the document still loads', () => {
    // A made-up block migration: every step 2 cause text gets a mark.
    const doc = raw('v1.json')
    const migrated = mapBlocks(doc, (block, step) =>
      step === 2 ? { ...block, causes: (block.causes as RawDocument[]).map((c) => ({ ...c, text: `${c.text} ✓` })) } : block,
    )
    type Copy = { block: { causes: { text: string }[] } }
    const steps = migrated.steps as Record<string, { confirmed: Copy; outdatedBy: Record<string, Copy> }>
    const marked = (copy: Copy) => copy.block.causes.every((c) => c.text.endsWith(' ✓'))
    expect(marked(steps[3].outdatedBy[2])).toBe(true)
    expect(marked(steps[2].confirmed)).toBe(true)
    expect(parseDocument(migrated).ok).toBe(true)
    // The input stays as it was.
    expect(doc).toEqual(raw('v1.json'))
  })
})
