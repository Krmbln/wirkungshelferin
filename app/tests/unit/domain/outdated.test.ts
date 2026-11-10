// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { confirmStep } from '../../../src/domain/check'
import { earlierChanges, outdatedBecauseOf, reachedBy } from '../../../src/domain/outdated'
import { reducer, type Action } from '../../../src/domain/reducer'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import type { StepId } from '../../../src/domain/types'
import { AT, FIRST, LATER, editCause, outdatedProject as project, reconfirm } from '../../outdated'

// Change handling (implementation plan step 21, PRD F6 "done when", tech design §9).

const statuses = (p: Project) => [0, 1, 2, 3, 4, 5, 6].map((s) => p.steps[s as StepId].status)

describe('re-confirm cascade', () => {
  it('re-confirming step 2 after a change marks confirmed steps 3–6 and leaves unconfirmed steps alone (PRD F6 "done when")', () => {
    const p = project({ 5: 'in_progress', 6: 'not_started' })
    const before = structuredClone(p.steps[2].confirmed!)
    const next = reconfirm(p, 2, [editCause('Kein Werkzeug und kein Raum')])
    expect(statuses(next)).toEqual(['confirmed', 'confirmed', 'confirmed', 'maybe_outdated', 'maybe_outdated', 'in_progress', 'not_started'])
    // Each outdated step keeps step 2 as it was built on it.
    expect(next.steps[3].outdatedBy).toEqual({ 2: { at: FIRST, block: before.block } })
    expect(next.steps[5].outdatedBy).toBeUndefined()
    projectSchema.parse(next)
  })

  it('editing alone triggers nothing', () => {
    const p = project()
    const edited = reducer(p, editCause('Anders'))
    expect(statuses(edited)).toEqual(['confirmed', 'confirmed', 'in_progress', 'confirmed', 'confirmed', 'confirmed', 'confirmed'])
    expect(edited.steps[3].outdatedBy).toBeUndefined()
  })

  it('a first confirm marks nothing (it is no re-confirm)', () => {
    const p = project({ 2: 'in_progress' })
    delete p.steps[2].confirmed
    const next = reconfirm(p, 2, [editCause('Anders')])
    expect(statuses(next).slice(3)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed'])
  })

  it('a re-confirm with the same content marks nothing: rev and "von dir geändert" are no content', () => {
    const p = project()
    const next = reconfirm(p, 2, [editCause('Anders'), editCause('Kein Werkzeug')])
    expect(next.steps[2].block.causes[0].rev).toBeGreaterThan(p.steps[2].block.causes[0].rev)
    expect(next.steps[2].block.causes[0].editedByUser).toBe(true)
    expect(statuses(next).slice(3)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed'])
  })

  it('an outdated step gets the new change added and keeps the oldest version it was built on', () => {
    const once = reconfirm(project(), 2, [editCause('Zweite Fassung')])
    const twice = reconfirm(once, 2, [editCause('Dritte Fassung')], LATER)
    expect(twice.steps[4].outdatedBy?.[2]?.at).toBe(FIRST)
    expect((twice.steps[4].outdatedBy?.[2]?.block.causes as { text: string }[])[0].text).toBe('Kein Werkzeug')
  })

  it('re-confirming an outdated step clears its own mark; unchanged, it marks nothing further down', () => {
    const marked = reconfirm(project(), 2, [editCause('Neu')])
    const four = reconfirm(marked, 4, [])
    expect(four.steps[4].status).toBe('confirmed')
    expect(four.steps[4].outdatedBy).toBeUndefined()
    expect(statuses(four).slice(3)).toEqual(['maybe_outdated', 'confirmed', 'maybe_outdated', 'maybe_outdated'])
    expect(four.steps[5].outdatedBy).toEqual(marked.steps[5].outdatedBy)
  })

  it('a change undone (A → B → A) clears the mark: confirmed again, or in Arbeit if edited meanwhile', () => {
    const once = reconfirm(project(), 2, [editCause('Zweite Fassung')])
    const edited = reducer(once, { type: 'item/add', step: 4, collection: 'resources', fields: { text: 'Neu' } })
    expect(edited.steps[4].status).toBe('maybe_outdated')
    const back = reconfirm(edited, 2, [editCause('Kein Werkzeug')], LATER)
    expect(statuses(back).slice(3)).toEqual(['confirmed', 'in_progress', 'confirmed', 'confirmed'])
    expect(back.steps[3].outdatedBy).toBeUndefined()
    projectSchema.parse(back)
  })

  it('an outdated step that was edited is marked again by a later change and keeps its oldest version', () => {
    const once = reconfirm(project(), 2, [editCause('Zweite Fassung')])
    const edited = reducer(once, { type: 'item/add', step: 4, collection: 'resources', fields: { text: 'Neu' } })
    const zero = reconfirm(edited, 0, [{ type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields: { location: 'Südstadt' } }], LATER)
    expect(zero.steps[4].status).toBe('maybe_outdated')
    expect(Object.keys(zero.steps[4].outdatedBy!)).toEqual(['0', '2'])
    expect(zero.steps[4].outdatedBy![2]!.at).toBe(FIRST)
  })

  it('a snapshot that is no valid block of its step is refused by the schema (step 24 migrations)', () => {
    const p = reconfirm(project(), 2, [editCause('Neu')])
    p.steps[3].outdatedBy![2]!.block = { problems: 'kaputt' }
    expect(projectSchema.safeParse(p).success).toBe(false)
  })

  it('confirmStep never touches the input', () => {
    const p = reducer(project(), editCause('Neu'))
    const checked = reducer(p, { type: 'check/store', step: 2, check: { at: AT, source: 'app', block: structuredClone(p.steps[2].block), results: [] } })
    const before = structuredClone(checked)
    confirmStep(checked, 2, AT)
    expect(checked).toEqual(before)
  })
})

describe('step 0 exception', () => {
  const profile = (fields: Record<string, unknown>): Action => ({ type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields })
  const frame = (fields: Record<string, unknown>): Action => ({ type: 'item/edit', step: 0, collection: 'frame', id: 'frame', fields })

  it('only the measurement frame changed → only steps 5–6', () => {
    const next = reconfirm(project(), 0, [frame({ audience: 'Vorstand' })])
    expect(statuses(next)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'maybe_outdated', 'maybe_outdated'])
    expect(earlierChanges(next, 5)).toMatchObject([{ step: 0, frameOnly: true }])
  })

  it('the profile changed → steps 1–6 (also with the frame)', () => {
    const next = reconfirm(project(), 0, [profile({ location: 'Südstadt' })])
    expect(statuses(next).slice(1)).toEqual(Array(6).fill('maybe_outdated'))
    expect(earlierChanges(next, 1)).toMatchObject([{ step: 0, frameOnly: false }])
    const both = reconfirm(project(), 0, [profile({ location: 'Südstadt' }), frame({ audience: 'Vorstand' })])
    expect(statuses(both).slice(1)).toEqual(Array(6).fill('maybe_outdated'))
  })

  it('frame first, then the profile: steps 1–4 join, 5–6 keep the oldest version (no longer "Messrahmen")', () => {
    const framed = reconfirm(project(), 0, [frame({ audience: 'Vorstand' })])
    const both = reconfirm(framed, 0, [profile({ location: 'Südstadt' })], LATER)
    expect(statuses(both).slice(1)).toEqual(Array(6).fill('maybe_outdated'))
    expect(both.steps[5].outdatedBy![0]!.at).toBe(FIRST)
    expect(earlierChanges(both, 5)[0].frameOnly).toBe(false)
    expect(earlierChanges(both, 2)[0].frameOnly).toBe(false)
  })

  it('a profile change reverted while the frame changed: steps 1–4 are confirmed again, 5–6 read "Messrahmen"', () => {
    const changed = reconfirm(project(), 0, [profile({ location: 'Südstadt' })])
    const reverted = reconfirm(changed, 0, [profile({ location: 'Nordstadt' }), frame({ audience: 'Vorstand' })], LATER)
    expect(statuses(reverted).slice(1)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'maybe_outdated', 'maybe_outdated'])
    expect(earlierChanges(reverted, 5)[0].frameOnly).toBe(true)
  })

  it('only a source added → nothing', () => {
    const add: Action = { type: 'item/add', step: 0, collection: 'sources', fields: { origin: 'paste', label: 'Antrag', text: 'Text', at: AT } }
    const next = reconfirm(project(), 0, [add])
    expect(statuses(next).slice(1)).toEqual(Array(6).fill('confirmed'))
  })

  it('reachedBy compares content per part', () => {
    const p = project()
    const block = p.steps[0].block as unknown as Record<string, unknown>
    const bumped = structuredClone(block) as { profile: { rev: number } }
    bumped.profile.rev = 7
    expect(reachedBy(0, block, bumped)).toEqual([])
  })
})

describe('what the outdated step reads', () => {
  it('earlierChanges: then and now per changed step, in step order; outdatedBecauseOf for the gate line', () => {
    const p = project({ 5: 'in_progress' })
    const zero = reconfirm(p, 0, [{ type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields: { location: 'Südstadt' } }])
    const both = reconfirm(zero, 2, [editCause('Neu')], LATER)
    const changes = earlierChanges(both, 4)
    expect(changes.map((c) => [c.step, c.then.at, c.now.at])).toEqual([
      [0, FIRST, AT],
      [2, FIRST, LATER],
    ])
    expect(outdatedBecauseOf(both, 2)).toEqual([3, 4, 6])
    expect(outdatedBecauseOf(both, 0)).toEqual([1, 3, 4, 6])
    // Step 1 confirmed again (unchanged): no longer outdated because of step 0.
    expect(outdatedBecauseOf(reconfirm(both, 1, []), 0)).toEqual([3, 4, 6])
  })
})
