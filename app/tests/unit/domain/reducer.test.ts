import { describe, expect, it } from 'vitest'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema } from '../../../src/domain/schemas/project'

const groups = () =>
  makeProject({
    steps: {
      1: {
        block: {
          targetGroups: [
            makeItem(1, 'targetGroups', { name: 'Kinder' }),
            makeItem(1, 'targetGroups', { name: 'Eltern' }),
            makeItem(1, 'targetGroups', { name: 'Schulen' }),
          ],
        },
      },
    },
  })

describe('Reducer: manual edits', () => {
  it('adds an item with the next id, empty fields, marked as edited by Lukas', () => {
    const p = reducer(groups(), { type: 'item/add', step: 1, collection: 'targetGroups', fields: { name: 'Trainer' } })
    const added = p.steps[1].block.targetGroups.at(-1)!
    expect(added).toMatchObject({ id: 'tg4', rev: 1, editedByUser: true, name: 'Trainer', description: '', reach: 'direct', isFocus: false })
    expect(p.idCounters.tg).toBe(4)
    expect(projectSchema.safeParse(p).success).toBe(true)
  })

  it('an edit raises rev and marks the item as edited by Lukas', () => {
    const p = reducer(groups(), { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg2', fields: { name: 'Eltern und Großeltern' } })
    expect(p.steps[1].block.targetGroups[1]).toMatchObject({ name: 'Eltern und Großeltern', rev: 2, editedByUser: true })
  })

  it('edits a singleton (challenge)', () => {
    const p = reducer(groups(), { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Zu wenig Orte', why: 'Weil …' } })
    expect(p.steps[1].block.challenge).toMatchObject({ text: 'Zu wenig Orte', why: 'Weil …', rev: 2 })
  })

  it('a deleted neighbour never shifts ids; a new item gets a fresh number', () => {
    let p = reducer(groups(), { type: 'item/remove', step: 1, collection: 'targetGroups', id: 'tg2' })
    expect(p.steps[1].block.targetGroups.map((t) => t.id)).toEqual(['tg1', 'tg3'])
    p = reducer(p, { type: 'item/add', step: 1, collection: 'targetGroups' })
    expect(p.steps[1].block.targetGroups.map((t) => t.id)).toEqual(['tg1', 'tg3', 'tg4'])
  })

  it('restore puts a removed item back at its place (10-second "Rückgängig")', () => {
    const start = groups()
    const removed = start.steps[1].block.targetGroups[1]
    let p = reducer(start, { type: 'item/remove', step: 1, collection: 'targetGroups', id: 'tg2' })
    p = reducer(p, { type: 'item/restore', step: 1, collection: 'targetGroups', item: removed, index: 1 })
    expect(p.steps[1].block.targetGroups.map((t) => t.id)).toEqual(['tg1', 'tg2', 'tg3'])
  })

  it('a first edit moves the step to "in Arbeit", also a confirmed one (reopening)', () => {
    const edit = { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'x' } } as const
    expect(reducer(groups(), edit).steps[1].status).toBe('in_progress')
    expect(reducer(makeProject({ steps: { 1: { status: 'confirmed' } } }), edit).steps[1].status).toBe('in_progress')
    expect(reducer(makeProject({ steps: { 1: { status: 'maybe_outdated' } } }), edit).steps[1].status).toBe('maybe_outdated')
  })

  it('never mutates the old state', () => {
    const start = groups()
    const copy = structuredClone(start)
    reducer(start, { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { name: 'neu' } })
    expect(start).toEqual(copy)
  })
})

describe('Reducer: actions that don\'t fit change nothing', () => {
  const cases = [
    { name: 'unknown collection', action: { type: 'item/add', step: 1, collection: 'goals' } },
    { name: 'invalid field value', action: { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { reach: 'sometimes' } } },
    { name: 'unknown field', action: { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { colour: 'red' } } },
    { name: 'changing the id', action: { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { id: 'tg9' } } },
    { name: 'editing a missing item', action: { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg9', fields: { name: 'x' } } },
    { name: 'removing a singleton', action: { type: 'item/remove', step: 1, collection: 'challenge', id: 'challenge' } },
    { name: 'adding a second singleton', action: { type: 'item/add', step: 1, collection: 'challenge' } },
  ] as const

  it.each(cases)('$name', ({ action }) => {
    const start = groups()
    expect(reducer(start, action as never)).toBe(start)
  })
})
