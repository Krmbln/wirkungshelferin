// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LooseBlock } from '../../../src/domain/block'
import { checkCurrent, confirmStep, hardIssues, openWarnings, sameBlock } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project, type QualityCheck } from '../../../src/domain/schemas/project'

// Hard blocks (⛔) and confirming (implementation plan step 13, PRD F4 "done when").

const AT = '2026-11-08T10:00:00.000Z'
const group = (id: string, fields: Record<string, unknown>) =>
  makeItem(1, 'targetGroups', { name: `Gruppe ${id}`, description: '', reach: 'direct', isFocus: false, why: 'weil', ...fields }, { id })

function step1(block: Partial<Project['steps'][1]['block']> = {}, status: 'in_progress' | 'confirmed' = 'in_progress'): Project {
  return makeProject({
    steps: {
      0: { status: 'confirmed', confirmedAt: '2026-11-01T09:00:00.000Z' },
      1: {
        status,
        block: {
          challenge: makeItem(1, 'challenge', { text: 'Zu wenig Orte am Nachmittag', why: 'Daran hängt alles.' }),
          targetGroups: [group('tg1', { isFocus: true })],
          stakeholders: [],
          ...block,
        },
      },
    },
  })
}

const results = (warn: string[] = []): QualityCheck['results'] =>
  ['1', '2', '3', '4', '5', '6', '7', '8'].map((criterion) => ({ criterion, result: warn.includes(criterion) ? 'warn' : 'ok', note: `Satz zu ${criterion}` }))

const checked = (p: Project, warn: string[] = []) =>
  reducer(p, { type: 'check/store', step: 1, check: { at: AT, source: 'app', block: structuredClone(p.steps[1].block), results: results(warn) } })

const block1 = (p: Project) => p.steps[1].block as unknown as LooseBlock

describe('hardIssues (step 1)', () => {
  it('finds nothing in a complete block', () => {
    expect(hardIssues(1, block1(step1()))).toEqual([])
  })

  it('a missing or blank Why on the challenge and on each target group blocks (criterion 8)', () => {
    const p = step1({
      challenge: makeItem(1, 'challenge', { text: 'x', why: '  ' }),
      targetGroups: [group('tg1', { isFocus: true, why: '' }), group('tg2', { name: '', why: undefined })],
    })
    expect(hardIssues(1, block1(p))).toEqual([
      { criterion: '8', text: 'Warum fehlt: Herausforderung', target: { collection: 'challenge', id: 'challenge', field: 'why' } },
      { criterion: '8', text: 'Warum fehlt: Zielgruppe „Gruppe tg1“', target: { collection: 'targetGroups', id: 'tg1', field: 'why' } },
      { criterion: '8', text: 'Warum fehlt: Zielgruppe „Zielgruppe ohne Namen“', target: { collection: 'targetGroups', id: 'tg2', field: 'why' } },
    ])
  })

  it('stakeholders carry no Why, so they never block', () => {
    const p = step1({ stakeholders: [makeItem(1, 'stakeholders', { role: 'Schule', expectations: [] }, { id: 'sh1' })] })
    expect(hardIssues(1, block1(p))).toEqual([])
  })

  it('0 focus groups blocks, pointing at the first group or at "+ hinzufügen" (criterion 5)', () => {
    expect(hardIssues(1, block1(step1({ targetGroups: [group('tg1', {}), group('tg2', {})] })))).toEqual([
      { criterion: '5', text: 'Noch keine Fokusgruppe gewählt (1 oder 2)', target: { collection: 'targetGroups', id: 'tg1', field: 'isFocus' } },
    ])
    expect(hardIssues(1, block1(step1({ targetGroups: [] })))[0].target).toEqual({ collection: 'targetGroups', field: 'add' })
  })

  it('2 focus groups are fine, 3 block and point at the third', () => {
    const two = [group('tg1', { isFocus: true }), group('tg2', { isFocus: true })]
    expect(hardIssues(1, block1(step1({ targetGroups: two })))).toEqual([])
    const three = [...two, group('tg3', { isFocus: true })]
    expect(hardIssues(1, block1(step1({ targetGroups: three })))).toEqual([
      { criterion: '5', text: '3 Fokusgruppen gewählt – höchstens 2', target: { collection: 'targetGroups', id: 'tg3', field: 'isFocus' } },
    ])
  })

  it('steps without rules yet have none', () => {
    expect(hardIssues(5, {} as LooseBlock)).toEqual([])
  })
})

describe('sameBlock and checkCurrent', () => {
  it('compares content, not key order', () => {
    expect(sameBlock({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(sameBlock({ a: 1 }, { a: 2 })).toBe(false)
    // Like JSON: a key holding undefined is the same as no key (e.g. a cleared size).
    expect(sameBlock({ a: 1, size: undefined }, { a: 1 })).toBe(true)
  })

  it('an edit or an applied change after the check makes it old', () => {
    const p = checked(step1())
    expect(checkCurrent(p, 1)).toBe(true)
    const edited = reducer(p, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { why: 'Neu' } })
    expect(checkCurrent(edited, 1)).toBe(false)
  })
})

describe('step/confirm', () => {
  it('confirms with the snapshot, the basis and the ⚠ points confirmed anyway', () => {
    const p = checked(step1(), ['2', '4'])
    const next = reducer(p, { type: 'step/confirm', step: 1, at: AT })
    const s = next.steps[1]
    expect(s.status).toBe('confirmed')
    expect(s.confirmed).toEqual({ at: AT, block: p.steps[1].block, basis: { 0: '2026-11-01T09:00:00.000Z' } })
    expect(s.confirmedWarnings).toEqual(['2', '4'])
    projectSchema.parse(next)
  })

  it('is refused while a Why is empty (PRD F4 "done when")', () => {
    const p = checked(step1({ targetGroups: [group('tg1', { isFocus: true, why: '' })] }))
    expect(reducer(p, { type: 'step/confirm', step: 1, at: AT })).toBe(p)
  })

  it('is refused without a check, and after an edit since the check', () => {
    const fresh = step1()
    expect(reducer(fresh, { type: 'step/confirm', step: 1, at: AT })).toBe(fresh)
    const p = reducer(checked(fresh), { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Anders' } })
    expect(reducer(p, { type: 'step/confirm', step: 1, at: AT })).toBe(p)
  })

  it('a ⚠ on a criterion a hard rule owns is not stored as confirmed anyway', () => {
    const p = checked(step1(), ['5', '7'])
    expect(openWarnings(1, p.steps[1].qualityCheck!)).toEqual(['5', '7'])
    const blocked = checked(step1({ targetGroups: [group('tg1', {})] }), ['5', '7'])
    expect(openWarnings(1, blocked.steps[1].qualityCheck!)).toEqual(['7'])
  })

  it('an edit after confirming reopens the step (status in Arbeit, snapshot kept)', () => {
    const p = reducer(checked(step1()), { type: 'step/confirm', step: 1, at: AT })
    const edited = reducer(p, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Anders' } })
    expect(edited.steps[1].status).toBe('in_progress')
    expect(edited.steps[1].confirmed?.at).toBe(AT)
  })

  it('confirmStep never touches the input', () => {
    const p = checked(step1())
    const before = structuredClone(p)
    confirmStep(p, 1, AT)
    expect(p).toEqual(before)
  })
})

describe('check/store', () => {
  it('an older check never replaces a newer one (gate and chat finishing in either order)', () => {
    const p = checked(step1())
    const older = { at: '2026-11-08T09:59:00.000Z', source: 'chat' as const, block: structuredClone(p.steps[1].block), results: results(['2']) }
    expect(reducer(p, { type: 'check/store', step: 1, check: older })).toBe(p)
    const newer = { ...older, at: '2026-11-08T10:01:00.000Z' }
    expect(reducer(p, { type: 'check/store', step: 1, check: newer }).steps[1].qualityCheck?.source).toBe('chat')
  })

  it('stores the check and leaves the status alone', () => {
    const p = checked(step1())
    expect(p.steps[1].qualityCheck).toMatchObject({ at: AT, source: 'app', results: results() })
    expect(p.steps[1].status).toBe('in_progress')
    projectSchema.parse(p)
  })
})
