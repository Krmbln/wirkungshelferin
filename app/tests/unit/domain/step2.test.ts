// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LooseBlock } from '../../../src/domain/block'
import { confirmStep, groupsOf, hardIssues } from '../../../src/domain/check'
import { makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { changeView } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import type { Item } from '../../../src/domain/schemas/blocks'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import { depthOf, panelGroupOf, stepGroups, treeOf } from '../../../src/domain/tree'

// Step 2 domain (implementation plan step 16, design §6.2 "Step 16"): groups, the cause tree,
// the ⛔ rules and staleness for hidden groups.

const AT = '2026-11-09T10:00:00.000Z'
const group = (id: string, isFocus: boolean, name = `Gruppe ${id}`) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const cause = (id: string, groupId: string, parentId = '', why = 'beobachtet') => makeItem(2, 'causes', { groupId, parentId, text: `Ursache ${id}`, why }, { id })

function project(groups = [group('tg1', true), group('tg2', true), group('tg3', false)]): Project {
  const p = makeProject({ steps: { 1: { status: 'confirmed', block: { targetGroups: groups } } } })
  p.steps[2].block = {
    problems: [
      makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Problem eins', why: 'sieht man' }, { id: 'pb1' }),
      makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Problem zwei', why: 'sieht man' }, { id: 'pb2' }),
    ],
    causes: [cause('ca1', 'tg1'), cause('ca2', 'tg1', 'ca1'), cause('ca3', 'tg1', 'ca2'), cause('ca4', 'tg2')],
    consequences: [makeItem(2, 'consequences', { groupId: 'tg1', parentId: '', text: 'Folge' }, { id: 'co1' })],
  }
  p.idCounters = { ...p.idCounters, tg: 9, pb: 2, ca: 4, co: 1 }
  return projectSchema.parse(p)
}

const issues = (p: Project) => hardIssues(2, p.steps[2].block as unknown as LooseBlock, groupsOf(p))
const ids = (rows: ReturnType<typeof treeOf>): unknown => rows.map((r) => (r.children.length ? [r.item.id, ids(r.children)] : r.item.id))

describe('groups and tree', () => {
  it('splits focus groups (step 1 order), other groups and vanished ones', () => {
    const p = project()
    p.steps[2].block.causes.push(cause('ca9', 'tg9') as never)
    const g = stepGroups(p, 2)
    expect(g.focus.map((x) => x.id)).toEqual(['tg1', 'tg2'])
    expect(g.other.map((x) => x.id)).toEqual(['tg3'])
    expect(g.orphans).toEqual(['tg9'])
  })

  it('builds the tree in list order; a missing parent makes a root; a cycle never hangs', () => {
    const p = project()
    const causes = p.steps[2].block.causes as Item[]
    expect(ids(treeOf(causes.filter((c) => c.groupId === 'tg1')))).toEqual([['ca1', [['ca2', ['ca3']]]]])
    expect(depthOf(causes, causes[2])).toBe(3)
    const lost = [cause('a', 'tg1', 'gone'), cause('b', 'tg1', 'a')]
    expect(ids(treeOf(lost))).toEqual([['a', ['b']]])
    const loop = [cause('x', 'tg1', 'y'), cause('y', 'tg1', 'x')]
    expect(ids(treeOf(loop))).toEqual(['x', 'y'])
    expect(depthOf(loop, loop[0])).toBe(2)
  })

  it('knows the panel group of an item, a not yet created core problem and a non-focus item', () => {
    const p = project()
    expect(panelGroupOf(p, 2, 'ca2')).toBe('tg1')
    expect(panelGroupOf(p, 2, 'problem:tg2')).toBe('tg2')
    expect(panelGroupOf(p, 2, 'problem:tg3')).toBe('other')
    expect(panelGroupOf(p, 1, 'tg1')).toBeUndefined()
  })
})

describe('removing a cause moves its children one level up; undo puts them back', () => {
  it('by hand (item/remove + item/restore)', () => {
    const p = project()
    const removed = p.steps[2].block.causes[1] as Item
    const after = reducer(p, { type: 'item/remove', step: 2, collection: 'causes', id: 'ca2' })
    expect(after.steps[2].block.causes.find((c) => c.id === 'ca3')!.parentId).toBe('ca1')
    expect(after.steps[2].block.causes.find((c) => c.id === 'ca3')!.rev).toBe(1)
    const back = reducer(after, { type: 'item/restore', step: 2, collection: 'causes', item: removed, index: 1, children: ['ca3'] })
    expect(back.steps[2].block.causes.map((c) => [c.id, c.parentId])).toEqual(p.steps[2].block.causes.map((c) => [c.id, c.parentId]))
  })

  it('through a proposal (ENTFERNEN applied, then Rückgängig)', () => {
    const p = project()
    p.steps[2].proposals = [makeProposal([{ op: 'remove', collection: 'causes', targetId: 'ca2', baseRev: 1 }])]
    const applied = reducer(p, { type: 'change/apply', step: 2, proposalId: 'p1', changeId: 'p1c1' })
    expect(applied.steps[2].block.causes.find((c) => c.id === 'ca3')!.parentId).toBe('ca1')
    expect(applied.steps[2].proposals[0].changes[0].undo!.children).toEqual(['ca3'])
    expect(projectSchema.safeParse(applied).success).toBe(true)
    const undone = reducer(applied, { type: 'change/undo', step: 2, proposalId: 'p1', changeId: 'p1c1' })
    expect(undone.steps[2].block.causes.find((c) => c.id === 'ca3')!.parentId).toBe('ca2')
  })
})

describe('staleness for steps 2–4', () => {
  it('a change for a group that is no longer a focus group is stale "hidden"; its core problem stays open', () => {
    const p = project([group('tg1', false), group('tg2', true)])
    p.steps[2].proposals = [
      makeProposal([
        { op: 'add', collection: 'causes', tempId: 'new:1', fields: { groupId: 'tg1', parentId: '', text: 'neu', evidence: 'unsicher', notInfluenceable: false, why: '' } },
        { op: 'update', collection: 'causes', targetId: 'ca1', baseRev: 1, fields: { text: 'anders' } },
        { op: 'update', collection: 'problems', targetId: 'pb1', baseRev: 1, fields: { coreProblem: 'anders' } },
      ]),
    ]
    expect(changeView(p, 2, 'p1', 'p1c1')).toEqual({ kind: 'stale', reason: 'hidden' })
    expect(changeView(p, 2, 'p1', 'p1c2')).toEqual({ kind: 'stale', reason: 'hidden' })
    expect(changeView(p, 2, 'p1', 'p1c3')).toEqual({ kind: 'open' })
  })

  it('a parent that is gone makes the change stale instead of leaving the item hanging', () => {
    const p = project()
    p.steps[2].proposals = [makeProposal([{ op: 'add', collection: 'causes', tempId: 'new:1', fields: { groupId: 'tg1', parentId: 'ca7', text: 'x', evidence: 'unsicher', notInfluenceable: false, why: '' } }])]
    expect(changeView(p, 2, 'p1', 'p1c1')).toEqual({ kind: 'stale', reason: 'invalid' })
  })
})

describe('hardIssues (step 2, criterion 9)', () => {
  it('a complete block has none', () => {
    expect(issues(project())).toEqual([])
  })

  it('a focus group without a core problem (or with an empty one) is blocked, with the group named', () => {
    const p = project()
    p.steps[2].block.problems = [{ ...p.steps[2].block.problems[0], coreProblem: '' }]
    expect(issues(p).map((i) => [i.text, i.target])).toEqual([
      ['Kernproblem fehlt · Gruppe tg1', { collection: 'problems', id: 'pb1', field: 'coreProblem', group: 'tg1' }],
      ['Kernproblem fehlt · Gruppe tg2', { collection: 'problems', id: 'problem:tg2', field: 'coreProblem', group: 'tg2' }],
    ])
  })

  it('a missing Why on a shown core problem (also non-focus) or cause blocks, in panel order; hidden causes count for nothing', () => {
    const p = project([group('tg1', true), group('tg2', false), group('tg3', false)])
    p.steps[2].block.causes = [cause('ca1', 'tg1', '', ''), cause('ca2', 'tg1', 'ca1', ''), cause('ca4', 'tg2', '', '')] as never
    p.steps[2].block.problems.push(makeItem(2, 'problems', { groupId: 'tg3', coreProblem: 'Dritte', why: '' }, { id: 'pb3' }) as never)
    p.steps[2].block.problems[1] = { ...p.steps[2].block.problems[1], why: '' }
    expect(issues(p).map((i) => i.text)).toEqual([
      'Warum fehlt: Ursache „Ursache ca1“ · Gruppe tg1',
      'Warum fehlt: Ursache „Ursache ca2“ · Gruppe tg1',
      'Warum fehlt: Kernproblem · Gruppe tg2',
      'Warum fehlt: Kernproblem · Gruppe tg3',
    ])
  })

  it('a missing non-focus core problem is not blocked (Claude judges criterion 8)', () => {
    const p = project([group('tg1', true), group('tg2', true), group('tg3', false), group('tg4', false)])
    expect(issues(p)).toEqual([])
  })

  it('cuts a long cause at 50 characters', () => {
    const p = project()
    p.steps[2].block.causes[0] = { ...p.steps[2].block.causes[0], text: 'a'.repeat(80), why: '' }
    expect(issues(p)[0].text).toBe(`Warum fehlt: Ursache „${'a'.repeat(49)} …“ · Gruppe tg1`)
  })

  it('no focus group or three point to step 1', () => {
    const none = issues(project([group('tg1', false)]))
    expect(none[0]).toMatchObject({ text: 'Wähle in Schritt 1 eine oder zwei Fokusgruppen', target: { step: 1 } })
    const three = issues(project([group('tg1', true), group('tg2', true), group('tg3', true)]))
    expect(three[0]).toMatchObject({ text: '3 Fokusgruppen in Schritt 1 – höchstens 2', target: { step: 1 } })
  })

  it('confirming is refused while a ⛔ is open', () => {
    const p = project()
    p.steps[2].block.causes[0] = { ...p.steps[2].block.causes[0], why: '' }
    const checked = reducer(p, { type: 'check/store', step: 2, check: { at: AT, source: 'app', block: structuredClone(p.steps[2].block), results: [] } })
    expect(confirmStep(checked, 2, AT)).toBe(checked)
    const fixed = reducer(checked, { type: 'item/edit', step: 2, collection: 'causes', id: 'ca1', fields: { why: 'jetzt' } })
    const rechecked = reducer(fixed, { type: 'check/store', step: 2, check: { at: '2026-11-09T11:00:00.000Z', source: 'app', block: structuredClone(fixed.steps[2].block), results: [] } })
    expect(confirmStep(rechecked, 2, AT).steps[2].status).toBe('confirmed')
  })
})
