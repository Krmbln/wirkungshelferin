// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LooseBlock } from '../../../src/domain/block'
import { appJudged, appOwned, confirmStep, hardIssues, issueContext, withAppJudged } from '../../../src/domain/check'
import { makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { applyChange, changeView } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import { panelGroupOf } from '../../../src/domain/tree'

// Step 3 domain (implementation plan step 17, design §6.2 "Step 17"): the ⛔ rules, the app's own
// ⚠ for broken links and missing time frames, and "a level has goals or a mark, never both".

const AT = '2026-11-09T10:00:00.000Z'
const group = (id: string, isFocus: boolean, name = `Gruppe ${id}`) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const goal = (id: string, groupId: string, level: 4 | 5 | 6, fields: Record<string, unknown> = {}) =>
  makeItem(3, 'goals', { groupId, level, text: `Ziel ${id}`, causeIds: groupId === 'tg1' ? ['ca1'] : [], timeFrame: 'bis 2027', why: 'nötig', ...fields }, { id })

/** tg1 focus (all three levels filled), tg2 non-focus with a goal, Stufe 7 filled: no ⛔. */
function project(): Project {
  const p = makeProject({ steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche'), group('tg2', false, 'Eltern')] } } } })
  p.steps[2].block = {
    problems: [
      makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Problem eins', why: 'sieht man' }, { id: 'pb1' }),
      makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Eltern wissen wenig', why: 'sieht man' }, { id: 'pb2' }),
    ],
    causes: [makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Kein Rad', why: 'gesehen' }, { id: 'ca1' })],
    consequences: [],
  }
  p.steps[3].block = {
    goals: [goal('go1', 'tg1', 6), goal('go2', 'tg1', 5), goal('go3', 'tg1', 4), goal('go4', 'tg2', 4)],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: 'Das Projekt trägt dazu bei, dass …', why: 'aus der Herausforderung' }, { id: 'level7' }),
  }
  p.idCounters = { ...p.idCounters, tg: 2, pb: 2, ca: 1, go: 4, na: 0 }
  return projectSchema.parse(p)
}

const issues = (p: Project) => hardIssues(3, p.steps[3].block as unknown as LooseBlock, ...issueContext(p))
const texts = (p: Project) => issues(p).map((i) => i.text)
const edit = (p: Project, collection: string, id: string, fields: Record<string, unknown>) => reducer(p, { type: 'item/edit', step: 3, collection, id, fields })

describe('step 3 ⛔ rules', () => {
  it('a complete block has none', () => {
    expect(issues(project())).toEqual([])
  })

  it('criterion 4: a level without goal and without mark; Zum Feld goes to that level’s "+ Ziel"', () => {
    const p = reducer(project(), { type: 'item/remove', step: 3, collection: 'goals', id: 'go2' })
    expect(issues(p)).toEqual([
      { criterion: '4', text: 'Stufe 5 ist leer · Jugendliche', target: { collection: 'goals', id: 'tg1-5', field: 'add', group: 'tg1' } },
    ])
  })

  it('a goal without text counts as missing, and Zum Feld goes to that row instead', () => {
    const p = edit(project(), 'goals', 'go2', { text: '' })
    expect(issues(p)).toEqual([{ criterion: '4', text: 'Stufe 5 ist leer · Jugendliche', target: { collection: 'goals', id: 'go2', field: 'text', group: 'tg1' } }])
  })

  it('a "trifft nicht zu" mark fills the level, but needs its Why (criterion 10)', () => {
    let p = reducer(project(), { type: 'item/remove', step: 3, collection: 'goals', id: 'go2' })
    p = reducer(p, { type: 'item/add', step: 3, collection: 'levelNotApplicable', fields: { groupId: 'tg1', level: 5 } })
    expect(issues(p)).toEqual([
      { criterion: '10', text: 'Warum fehlt: Stufe 5 trifft nicht zu · Jugendliche', target: { collection: 'levelNotApplicable', id: 'na1', field: 'why', group: 'tg1' } },
    ])
    expect(issues(edit(p, 'levelNotApplicable', 'na1', { why: 'Hier ändert sich nichts.' }))).toEqual([])
  })

  it('criterion 5: a focus goal never linked to a cause is ⛔; a non-focus goal needs no link of its own', () => {
    const p = edit(project(), 'goals', 'go1', { causeIds: [] })
    expect(issues(p)).toEqual([{ criterion: '5', text: 'Ziel ohne Ursache: „Ziel go1“ · Jugendliche', target: { collection: 'goals', id: 'go1', field: 'causeIds', group: 'tg1' } }])
  })

  it('criterion 5 for a non-focus group: its goals need its core problem from step 2 (fix lies in step 2)', () => {
    const p = project()
    p.steps[2].block.problems = p.steps[2].block.problems.filter((x) => x.id !== 'pb2')
    expect(issues(p)).toEqual([
      { criterion: '5', text: 'Kein Kernproblem in Schritt 2 · Eltern', target: { collection: 'problems', id: 'problem:tg2', field: 'coreProblem', step: 2, group: 'tg2' } },
    ])
  })

  it('criterion 9: a non-focus group without goal', () => {
    const p = reducer(project(), { type: 'item/remove', step: 3, collection: 'goals', id: 'go4' })
    expect(issues(p)).toEqual([{ criterion: '9', text: 'Kein Ziel · Eltern', target: { collection: 'goals', id: 'tg2', field: 'add', group: 'tg2' } }])
  })

  it('criterion 10 for goals, criterion 8 for a missing Stufe 7, then its Why', () => {
    let p = edit(project(), 'goals', 'go4', { why: '' })
    p = edit(p, 'level7', 'level7', { text: '' })
    expect(texts(p)).toEqual(['Warum fehlt: Ziel „Ziel go4“ · Eltern', 'Stufe 7 fehlt'])
    p = edit(p, 'level7', 'level7', { text: 'Das Projekt trägt dazu bei, dass …', why: '' })
    expect(texts(p)).toEqual(['Warum fehlt: Ziel „Ziel go4“ · Eltern', 'Warum fehlt: Stufe 7'])
  })

  it('no focus group, or three: the fix lies in step 1', () => {
    const p = project()
    p.steps[1].block.targetGroups[0].isFocus = false
    expect(issues(p)[0]).toEqual({ criterion: '4', text: 'Wähle in Schritt 1 eine oder zwei Fokusgruppen', target: { collection: 'targetGroups', field: 'isFocus', step: 1 } })
  })

  it('confirming is refused while a ⛔ is open', () => {
    let p = reducer(project(), { type: 'item/remove', step: 3, collection: 'goals', id: 'go2' })
    p = reducer(p, { type: 'check/store', step: 3, check: { at: AT, source: 'app', block: structuredClone(p.steps[3].block), results: [] } as never })
    expect(confirmStep(p, 3, AT).steps[3].status).not.toBe('confirmed')
  })
})

describe('step 3 criteria the app judges (⚠)', () => {
  it('Claude may leave out 4, 5, 6, 9 and 10, but judges 8 (wording) itself', () => {
    expect(appOwned(3).sort()).toEqual(['10', '4', '5', '6', '9'])
  })

  it('a link whose cause was deleted in step 2 is ⚠ "Verweis fehlt", not ⛔', () => {
    const p = project()
    p.steps[2].block.causes = []
    const block = p.steps[3].block as unknown as LooseBlock
    expect(issues(p)).toEqual([])
    const five = appJudged(3, block, p).find((j) => j.criterion === '5')!
    expect(five).toMatchObject({ result: 'warn', note: 'Verweis fehlt: Ziel „Ziel go1“ · Jugendliche (und 2 weitere)', target: { collection: 'goals', id: 'go1', field: 'causeIds' } })
  })

  it('a non-focus goal’s old cause links (kept from when it was a focus group) never count as broken', () => {
    const p = project()
    p.steps[3].block.goals[3].causeIds = ['ca7']
    const five = appJudged(3, p.steps[3].block as unknown as LooseBlock, p).find((j) => j.criterion === '5')!
    expect(five.result).toBe('ok')
  })

  it('a goal without time frame is ⚠ 6; with all time frames ✓', () => {
    const p = edit(project(), 'goals', 'go3', { timeFrame: '' })
    const block = p.steps[3].block as unknown as LooseBlock
    expect(appJudged(3, block, p).find((j) => j.criterion === '6')).toMatchObject({ result: 'warn', note: 'Zeitrahmen fehlt: Ziel „Ziel go3“ · Jugendliche' })
    const ok = project()
    expect(appJudged(3, ok.steps[3].block as unknown as LooseBlock, ok).map((j) => j.result)).toEqual(['ok', 'ok'])
  })

  it('the stored check carries the app’s judgement, whatever Claude said', () => {
    const p = edit(project(), 'goals', 'go3', { timeFrame: '' })
    const block = p.steps[3].block as unknown as LooseBlock
    const results = withAppJudged(3, block, [{ criterion: '6', result: 'ok', note: 'Von der App geprüft.' }], p)
    expect(results[0].result).toBe('warn')
  })
})

describe('step 3 groups and levels', () => {
  it('a non-focus group keeps its goals, its marks are hidden', () => {
    const p = project()
    p.steps[3].block.levelNotApplicable = [makeItem(3, 'levelNotApplicable', { groupId: 'tg2', level: 5, why: '' }, { id: 'na1' })]
    p.steps[3].proposals = [
      makeProposal(
        [
          { op: 'update', collection: 'goals', targetId: 'go4', baseRev: 1, fields: { text: 'neu' } },
          { op: 'update', collection: 'levelNotApplicable', targetId: 'na1', baseRev: 1, fields: { why: 'x' } },
        ],
        { id: 'p1' },
      ),
    ]
    expect(changeView(p, 3, 'p1', 'p1c1').kind).toBe('open')
    expect(changeView(p, 3, 'p1', 'p1c2')).toEqual({ kind: 'stale', reason: 'hidden' })
    expect(panelGroupOf(p, 3, 'go4')).toBe('other')
    expect(panelGroupOf(p, 3, 'go1')).toBe('tg1')
  })

  it('a goal on a marked level waits for the removal of the mark in the same proposal', () => {
    const p = project()
    p.steps[3].block.levelNotApplicable = [makeItem(3, 'levelNotApplicable', { groupId: 'tg1', level: 4, why: 'nichts' }, { id: 'na1' })]
    p.steps[3].block.goals = p.steps[3].block.goals.filter((g) => g.id !== 'go3')
    const add = { op: 'add' as const, collection: 'goals', tempId: 'new:1', fields: { groupId: 'tg1', level: 4, text: 'Sie können flicken.', causeIds: ['ca1'], timeFrame: '', why: '' } }
    p.steps[3].proposals = [makeProposal([add, { op: 'remove', collection: 'levelNotApplicable', targetId: 'na1', baseRev: 1 }], { id: 'p1' })]
    expect(changeView(p, 3, 'p1', 'p1c1')).toEqual({ kind: 'blocked', needs: 'p1c2' })
    const removed = applyChange(p, 3, 'p1', 'p1c2')
    expect(changeView(removed, 3, 'p1', 'p1c1').kind).toBe('open')
    // Without the removal it can't apply at all.
    const alone = structuredClone(p)
    alone.steps[3].proposals = [makeProposal([add], { id: 'p2' })]
    expect(changeView(alone, 3, 'p2', 'p2c1')).toEqual({ kind: 'stale', reason: 'invalid' })
  })

  it('a mark on a level that has goals can’t apply unless the goals go in the same proposal', () => {
    const p = project()
    p.steps[3].proposals = [makeProposal([{ op: 'add', collection: 'levelNotApplicable', tempId: 'new:1', fields: { groupId: 'tg1', level: 6, why: 'x' } }], { id: 'p1' })]
    expect(changeView(p, 3, 'p1', 'p1c1')).toEqual({ kind: 'stale', reason: 'invalid' })
  })
})
