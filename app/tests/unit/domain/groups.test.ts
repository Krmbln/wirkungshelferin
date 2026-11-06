import { describe, expect, it } from 'vitest'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { groupContent } from '../../../src/domain/groups'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema } from '../../../src/domain/schemas/project'

// A target group's content in steps 2–4, and the hard delete (PRD F5, implementation plan step 11).

const withContent = () =>
  makeProject({
    steps: {
      1: {
        status: 'confirmed',
        block: {
          targetGroups: [
            makeItem(1, 'targetGroups', { name: 'Jugendliche', isFocus: true }, { id: 'tg1' }),
            makeItem(1, 'targetGroups', { name: 'Eltern' }, { id: 'tg2' }),
          ],
        },
      },
      2: {
        status: 'confirmed',
        block: {
          problems: [makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Kein eigenes Rad' }), makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Sorge' })],
          causes: [makeItem(2, 'causes', { groupId: 'tg1', text: 'Räder sind teuer' })],
        },
      },
      3: { block: { goals: [makeItem(3, 'goals', { groupId: 'tg1', level: 5, text: 'Reparieren selbst', causeIds: ['ca1'] })] } },
      4: { block: { externalFactors: [makeItem(4, 'externalFactors', { text: 'Wetter' })] } },
      5: { block: { focusQuestions: [makeItem(5, 'focusQuestions', { text: 'Reparieren sie selbst?', goalIds: ['go1'] })] } },
    },
  })

describe('Target groups: content in later steps', () => {
  it('counts the step 2–4 items that hang on the group, per step', () => {
    const p = withContent()
    expect(groupContent(p, 'tg1')).toEqual({ 2: 2, 3: 1 })
    expect(groupContent(p, 'tg2')).toEqual({ 2: 1 })
    expect(groupContent(p, 'tg9')).toEqual({})
  })

  it('a hard delete removes the group and its step 2–4 items, nothing else', () => {
    const before = withContent()
    const p = reducer(before, { type: 'targetGroup/delete', id: 'tg1' })
    expect(p.steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg2'])
    expect(p.steps[2].block.problems.map((i) => i.id)).toEqual(['pb2'])
    expect(p.steps[2].block.causes).toEqual([])
    expect(p.steps[3].block.goals).toEqual([])
    // Not tied to a group: stays. Step 5 keeps its reference, which now shows "Verweis fehlt".
    expect(p.steps[4].block.externalFactors).toHaveLength(1)
    expect(p.steps[5].block.focusQuestions[0].goalIds).toEqual(['go1'])
    expect(projectSchema.safeParse(p).success).toBe(true)
    expect(before.steps[1].block.targetGroups).toHaveLength(2)
  })

  it('a hard delete reopens step 1 only; later steps are left to change handling (step 21)', () => {
    const p = reducer(withContent(), { type: 'targetGroup/delete', id: 'tg1' })
    expect(p.steps[1].status).toBe('in_progress')
    expect(p.steps[2].status).toBe('confirmed')
  })

  it('ids stay used: a new group after a delete gets a fresh number', () => {
    let p = reducer(withContent(), { type: 'targetGroup/delete', id: 'tg2' })
    p = reducer(p, { type: 'item/add', step: 1, collection: 'targetGroups' })
    expect(p.steps[1].block.targetGroups.at(-1)!.id).toBe('tg3')
  })

  it('an unknown group changes nothing', () => {
    const p = withContent()
    expect(reducer(p, { type: 'targetGroup/delete', id: 'tg9' })).toBe(p)
  })
})

describe('Reducer: discarding a row left empty', () => {
  const added = () => reducer(makeProject(), { type: 'item/add', step: 1, collection: 'targetGroups' })

  it('removes a row with nothing in it', () => {
    const p = reducer(added(), { type: 'item/discard', step: 1, collection: 'targetGroups', id: 'tg1' })
    expect(p.steps[1].block.targetGroups).toEqual([])
  })

  it.each([
    ['a name', { name: 'Kinder' }],
    ['a Why', { why: 'Weil …' }],
    ['"indirekt"', { reach: 'indirect' }],
    ['a size', { sizeEstimate: 'etwa 20' }],
  ])('keeps a row with %s', (_, fields) => {
    const p = reducer(added(), { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields })
    expect(reducer(p, { type: 'item/discard', step: 1, collection: 'targetGroups', id: 'tg1' })).toBe(p)
  })

  it('keeps a stakeholder with an expectation', () => {
    let p = reducer(makeProject(), { type: 'item/add', step: 1, collection: 'stakeholders' })
    p = reducer(p, { type: 'item/edit', step: 1, collection: 'stakeholders', id: 'sh1', fields: { expectations: ['Ruhe'] } })
    expect(reducer(p, { type: 'item/discard', step: 1, collection: 'stakeholders', id: 'sh1' })).toBe(p)
  })
})
