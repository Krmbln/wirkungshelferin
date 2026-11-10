// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LooseBlock } from '../../../src/domain/block'
import { isEmptyItem } from '../../../src/domain/block'
import { appJudged, appOwned, confirmStep, hardIssues, issueContext, withAppJudged } from '../../../src/domain/check'
import { candidates, decisionOf, defaultLevel, fullFor, oldDeferrals, uncoveredGroups } from '../../../src/domain/focus'
import { makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { applyChange, changeView, undoChange } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project, type QualityCheck } from '../../../src/domain/schemas/project'

// Step 5 domain (implementation plan step 19, design §6.2 "Step 19"): candidates derived from
// step 4, the limits (mandatory figures don't count), removing a question with its indicators,
// the ⛔ rules and the app's own ⚠.

const AT = '2026-11-09T10:00:00.000Z'
const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const goal = (id: string, groupId: string, level: 4 | 5 | 6, text: string) => makeItem(3, 'goals', { groupId, level, text, causeIds: [], timeFrame: 'bis 2027', why: 'nötig' }, { id })
const link = (id: string, groupId: string, fromId: string, toId: string, fields: Record<string, unknown> = {}) =>
  makeItem(4, 'links', { groupId, fromId, toId, because: 'weil', assumption: `Annahme ${id}`, evidence: 'forschung', critical: false, ...fields }, { id })
const question = (id: string, fields: Record<string, unknown> = {}) =>
  makeItem(5, 'focusQuestions', { text: `Frage ${id}?`, reasons: ['eigenes_lernen'], audience: 'Vorstand', linkIds: [], goalIds: ['go2'], why: 'damit', ...fields }, { id })
const indicator = (id: string, focusQuestionId: string, fields: Record<string, unknown> = {}) =>
  makeItem(5, 'indicators', { focusQuestionId, level: 5, text: `Indikator ${id}`, baseline: 'ab jetzt', target: 'die Hälfte', why: 'zeigt es', ...fields }, { id })

/**
 * tg1 + tg2 focus, tg3 not. Candidates: li1 (tg1, eigene Erfahrung) and li4 (tg2, unsicher);
 * li2 is critical but well supported, li3 unsure but not critical, li5 belongs to tg3.
 */
function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche'), group('tg2', true, 'Mädchen'), group('tg3', false, 'Eltern')] } } },
  })
  p.steps[3].block = {
    goals: [goal('go1', 'tg1', 4, 'Sie wissen, wie ein Rad funktioniert'), goal('go2', 'tg1', 5, 'Sie reparieren selbst'), goal('go3', 'tg2', 5, 'Sie schrauben selbst')],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: 'x', why: 'x' }, { id: 'level7' }),
  }
  p.steps[4].block = {
    resources: [],
    activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt', why: 'damit' }, { id: 'ac1' })],
    outputs: [makeItem(4, 'outputs', { groupId: 'tg1', level: 1, text: 'Werkstatt hat offen' }, { id: 'ou1' })],
    links: [
      link('li2', 'tg1', 'ou1', 'go1', { critical: true, evidence: 'eigene_daten' }),
      link('li1', 'tg1', 'ac1', 'ou1', { critical: true, evidence: 'eigene_erfahrung' }),
      link('li3', 'tg1', 'go1', 'go2', { evidence: 'unsicher' }),
      link('li4', 'tg2', 'ac1', 'go3', { critical: true, evidence: 'unsicher' }),
      link('li5', 'tg3', 'ac1', 'go3', { critical: true, evidence: 'unsicher' }),
    ],
    externalFactors: [],
    sideEffects: [],
  }
  p.steps[5].block = {
    focusQuestions: [question('fq1', { linkIds: ['li1'], goalIds: [], reasons: ['kritische_annahme'] }), question('fq2')],
    deferredCandidates: [],
    indicators: [indicator('in1', 'fq1', { level: 1 }), indicator('in2', 'fq2'), indicator('in3', 'fq2')],
    mandatoryFigures: [],
  }
  p.idCounters = { ...p.idCounters, tg: 3, go: 3, ac: 1, ou: 1, li: 5, fq: 2, in: 3 }
  return projectSchema.parse(p)
}

const block = (p: Project) => p.steps[5].block as unknown as LooseBlock
const issues = (p: Project) => hardIssues(5, block(p), ...issueContext(p))
const judged = (p: Project, criterion: string) => appJudged(5, block(p), p).find((j) => j.criterion === criterion)!
const step4Edit = (p: Project, id: string, fields: Record<string, unknown>) => reducer(p, { type: 'item/edit', step: 4, collection: 'links', id, fields })
const add5 = (p: Project, collection: string, fields: Record<string, unknown>) => reducer(p, { type: 'item/add', step: 5, collection, fields })
const ids = (list: { id: string }[]) => list.map((i) => i.id)

describe('candidates', () => {
  it('are the critical, weakly supported links of focus groups, in panel order (step 1 groups, chain order)', () => {
    expect(candidates(project()).map((c) => [c.link.id, c.group.id])).toEqual([
      ['li1', 'tg1'],
      ['li4', 'tg2'],
    ])
  })

  it('update when step 4 changes: ticking "kritisch", better evidence, a deleted link (the plan’s test)', () => {
    let p = project()
    p = step4Edit(p, 'li3', { critical: true })
    expect(ids(candidates(p).map((c) => c.link))).toEqual(['li1', 'li3', 'li4'])
    p = step4Edit(p, 'li1', { evidence: 'forschung' })
    expect(ids(candidates(p).map((c) => c.link))).toEqual(['li3', 'li4'])
    p = reducer(p, { type: 'item/remove', step: 4, collection: 'links', id: 'li4' })
    expect(ids(candidates(p).map((c) => c.link))).toEqual(['li3'])
    // Nothing was copied into step 5.
    expect(p.steps[5].block.deferredCandidates).toEqual([])
  })

  it('a group that stops being a focus group takes its candidates along', () => {
    const p = reducer(project(), { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg2', fields: { isFocus: false } })
    expect(ids(candidates(p).map((c) => c.link))).toEqual(['li1'])
  })

  it('decision: tested by a question, deferred, or open', () => {
    let p = add5(project(), 'deferredCandidates', { linkId: 'li4', reason: '' })
    expect(decisionOf(block(p), 'li1')).toEqual({ kind: 'included', questions: [1] })
    expect(decisionOf(block(p), 'li4').kind).toBe('deferred')
    p = reducer(p, { type: 'item/remove', step: 5, collection: 'deferredCandidates', id: 'dc1' })
    expect(decisionOf(block(p), 'li4')).toEqual({ kind: 'open' })
  })

  it('old deferrals say why they are no candidate any more; re-ticking makes one current again with its reason', () => {
    let p = project()
    for (const linkId of ['li1', 'li4']) p = add5(p, 'deferredCandidates', { linkId, reason: `weil ${linkId}` })
    p = add5(p, 'deferredCandidates', { linkId: 'li4', reason: 'doppelt' })
    p = add5(p, 'deferredCandidates', { linkId: 'li9', reason: 'weg' })
    p = step4Edit(p, 'li1', { critical: false })
    expect(oldDeferrals(p, block(p)).map((o) => [o.deferral.linkId, o.cause])).toEqual([
      ['li1', 'notCritical'],
      ['li4', 'duplicate'],
      ['li9', 'removed'],
    ])
    const evidence = step4Edit(p, 'li4', { evidence: 'eigene_daten' })
    expect(oldDeferrals(evidence, block(evidence)).find((o) => o.deferral.id === 'dc2')).toMatchObject({ cause: 'evidence', evidence: 'eigene_daten' })
    p = step4Edit(p, 'li1', { critical: true })
    expect(oldDeferrals(p, block(p)).map((o) => o.deferral.linkId)).not.toContain('li1')
    expect(p.steps[5].block.deferredCandidates[0].reason).toBe('weil li1')
  })
})

describe('limits', () => {
  it('3 questions, 2 indicators per question, 6 in total', () => {
    const p = project()
    expect(fullFor(block(p), 'indicators', 'fq2')).toBe('perQuestion')
    expect(fullFor(block(p), 'indicators', 'fq1')).toBeUndefined()
    expect(fullFor(block(p), 'focusQuestions')).toBeUndefined()
    const three = add5(p, 'focusQuestions', { text: 'Dritte?' })
    expect(fullFor(block(three), 'focusQuestions')).toBe('questions')
    let six = three
    for (const _ of [1, 2, 3]) six = add5(six, 'indicators', { focusQuestionId: 'fq3', text: 'x' })
    expect(six.steps[5].block.indicators).toHaveLength(6)
    expect(fullFor(block(six), 'indicators', 'fq1')).toBe('total')
  })

  it('mandatory figures never count toward the 6 indicators (the plan’s test)', () => {
    let p = project()
    for (const name of ['Teilnehmende nach Geschlecht', 'Anzahl Termine', 'Anzahl Räder', 'Elternabende', 'Ausflüge', 'Presse', 'Fortbildungen'])
      p = add5(p, 'mandatoryFigures', { name, target: '10' })
    expect(p.steps[5].block.mandatoryFigures).toHaveLength(7)
    expect(fullFor(block(p), 'indicators', 'fq1')).toBeUndefined()
    expect(issues(p).map((i) => i.text)).not.toContainEqual(expect.stringContaining('Indikatoren – höchstens'))
  })

  it('an Übernehmen that no longer fits waits with a reason; it opens again once there is room', () => {
    let p = project()
    p.steps[5].proposals = [
      makeProposal(
        [
          { op: 'add', collection: 'focusQuestions', tempId: 'new:1', fields: { text: 'Neu?', reasons: [], audience: '', linkIds: [], goalIds: ['go1'], why: '' } },
          { op: 'add', collection: 'indicators', tempId: 'new:2', fields: { focusQuestionId: 'fq2', level: 5, text: 'Dritter', baseline: '', target: '', why: '' } },
        ],
        { id: 'p1' },
      ),
    ]
    expect(changeView(p, 5, 'p1', 'p1c2')).toEqual({ kind: 'blocked', full: 'perQuestion' })
    expect(changeView(p, 5, 'p1', 'p1c1').kind).toBe('open')
    p = add5(p, 'focusQuestions', { text: 'Von Hand' })
    expect(changeView(p, 5, 'p1', 'p1c1')).toEqual({ kind: 'blocked', full: 'questions' })
    expect(applyChange(p, 5, 'p1', 'p1c1')).toBe(p)
    p = reducer(p, { type: 'item/remove', step: 5, collection: 'indicators', id: 'in3' })
    expect(changeView(p, 5, 'p1', 'p1c2').kind).toBe('open')
  })
})

describe('removing a question', () => {
  it('takes its indicators along; undo by hand brings them back at their places', () => {
    const p = project()
    const gone = reducer(p, { type: 'item/remove', step: 5, collection: 'focusQuestions', id: 'fq2' })
    expect(ids(gone.steps[5].block.indicators)).toEqual(['in1'])
    const dependents = p.steps[5].block.indicators.flatMap((item, index) => (item.focusQuestionId === 'fq2' ? [{ collection: 'indicators', index, item }] : []))
    const back = reducer(gone, { type: 'item/restore', step: 5, collection: 'focusQuestions', item: p.steps[5].block.focusQuestions[1], index: 1, dependents })
    expect(back.steps[5].block).toEqual(p.steps[5].block)
  })

  it('through a proposal too, and its undo puts them back', () => {
    const p = project()
    p.steps[5].proposals = [makeProposal([{ op: 'remove', collection: 'focusQuestions', targetId: 'fq2', baseRev: 1 }], { id: 'p1' })]
    const applied = applyChange(p, 5, 'p1', 'p1c1')
    expect(ids(applied.steps[5].block.indicators)).toEqual(['in1'])
    expect(applied.steps[5].proposals[0].changes[0].undo?.dependents).toHaveLength(2)
    expect(undoChange(applied, 5, 'p1', 'p1c1').steps[5].block).toEqual(p.steps[5].block)
  })

  it('other steps’ removals take nothing along', () => {
    const p = reducer(project(), { type: 'item/remove', step: 4, collection: 'links', id: 'li1' })
    expect(p.steps[5].block.focusQuestions[0].linkIds).toEqual(['li1'])
  })
})

describe('a deferred candidate and a question', () => {
  it('a question that would test a deferred link waits for the deferral’s removal in the same proposal', () => {
    let p = add5(project(), 'deferredCandidates', { linkId: 'li4', reason: 'später' })
    p.steps[5].proposals = [
      makeProposal(
        [
          { op: 'update', collection: 'focusQuestions', targetId: 'fq2', baseRev: 1, fields: { linkIds: ['li4'] } },
          { op: 'remove', collection: 'deferredCandidates', targetId: 'dc1', baseRev: 1 },
        ],
        { id: 'p1' },
      ),
      makeProposal([{ op: 'update', collection: 'focusQuestions', targetId: 'fq2', baseRev: 1, fields: { linkIds: ['li4'] } }], { id: 'p2' }),
    ]
    expect(changeView(p, 5, 'p1', 'p1c1')).toEqual({ kind: 'blocked', needs: 'p1c2' })
    expect(changeView(p, 5, 'p2', 'p2c1')).toEqual({ kind: 'stale', reason: 'invalid' })
    p = applyChange(p, 5, 'p1', 'p1c2')
    expect(changeView(p, 5, 'p1', 'p1c1').kind).toBe('open')
  })
})

describe('new rows by hand', () => {
  it('an indicator added under a question is still empty (its question and level are placement)', () => {
    const p = add5(project(), 'indicators', { focusQuestionId: 'fq1', level: 4 })
    const row = p.steps[5].block.indicators[3]
    expect(isEmptyItem(5, 'indicators', row as never)).toBe(true)
    expect(reducer(p, { type: 'item/discard', step: 5, collection: 'indicators', id: row.id }).steps[5].block.indicators).toHaveLength(3)
  })

  it('a question’s new indicator starts at its first reference’s level, else Stufe 4', () => {
    const p = project()
    const [fq1, fq2] = p.steps[5].block.focusQuestions
    expect(defaultLevel(p, fq1 as never)).toBe(1) // li1 ends at ou1 (Stufe 1)
    expect(defaultLevel(p, fq2 as never)).toBe(5) // go2
    expect(defaultLevel(p, { ...fq2, goalIds: ['go9'] } as never)).toBe(4)
    expect(defaultLevel(p, undefined)).toBe(4)
  })
})

describe('⛔ rules (criteria 1, 2, 5, 6, 13)', () => {
  it('a complete block has none', () => {
    expect(issues(project())).toEqual([])
  })

  it('no question; more than 3', () => {
    const none = project()
    none.steps[5].block.focusQuestions = []
    none.steps[5].block.indicators = []
    expect(issues(none)).toEqual([{ criterion: '1', text: 'Noch keine Lernfrage', target: { collection: 'focusQuestions', field: 'add' } }])
    const four = project()
    four.steps[5].block.focusQuestions.push(question('fq3'), question('fq4'))
    four.steps[5].block.indicators.push(indicator('in4', 'fq3'), indicator('in5', 'fq4'))
    expect(issues(four)[0]).toEqual({ criterion: '1', text: '4 Lernfragen – höchstens 3', target: { collection: 'focusQuestions', id: 'fq4', field: 'text' } })
  })

  it('a question without any reference, without indicator, with 3; more than 6 in total; an orphan; Whys', () => {
    const p = project()
    const b = p.steps[5].block
    b.focusQuestions[0] = { ...b.focusQuestions[0], linkIds: [], why: '' }
    b.indicators = b.indicators.filter((i) => i.id !== 'in1')
    b.indicators.push(indicator('in4', 'fq2', { why: '' }), indicator('in5', 'fq9'))
    expect(issues(p).map((i) => [i.criterion, i.text])).toEqual([
      ['2', 'Lernfrage ohne Bezug: Frage 1 „Frage fq1?“'],
      ['13', 'Warum fehlt: Frage 1 „Frage fq1?“'],
      ['5', 'Frage 1 „Frage fq1?“ hat keinen Indikator'],
      ['5', '3 Indikatoren bei Frage 2 „Frage fq2?“ – höchstens 2'],
      ['13', 'Warum fehlt: Indikator „Indikator in4“'],
      ['6', 'Indikator ohne Lernfrage: „Indikator in5“'],
    ])
    expect(issues(p)[2].target).toEqual({ collection: 'indicators', id: 'fq1', field: 'add' })
    const seven = project()
    seven.steps[5].block.focusQuestions.push(question('fq3'))
    seven.steps[5].block.indicators.push(indicator('in4', 'fq3'), indicator('in5', 'fq3'), indicator('in6', 'fq1'), indicator('in7', 'fq9'))
    expect(issues(seven).map((i) => i.text)).toContain('7 Indikatoren – höchstens 6')
  })

  it('confirm is refused while a ⛔ is open', () => {
    const p = project()
    p.steps[5].block.focusQuestions[1].why = ''
    const check: QualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[5].block), results: [] } as never
    p.steps[5].qualityCheck = check as never
    expect(confirmStep(p, 5, AT)).toBe(p)
  })
})

describe('the app’s own ⚠ (criteria 2, 3, 4, 11, 12)', () => {
  it('everything fine: ✓ in words; criterion 4 open while a candidate is undecided', () => {
    const p = project()
    expect(judged(p, '2')).toMatchObject({ result: 'ok' })
    expect(judged(p, '3')).toMatchObject({ result: 'ok' })
    expect(judged(p, '11')).toMatchObject({ result: 'ok', note: 'Jeder Indikator hat einen Ausgangswert oder einen Plan dafür.' })
    expect(judged(p, '4')).toMatchObject({ result: 'warn', note: 'Kandidat noch offen: „Annahme li4“', target: { collection: 'candidates', id: 'li4', field: 'decide' }, merge: true })
  })

  it('a deleted reference, missing reason or audience, baselines and targets — one row each with "(und n weitere)"', () => {
    const p = project()
    const b = p.steps[5].block
    b.focusQuestions[1] = { ...b.focusQuestions[1], goalIds: ['go9'], reasons: [], audience: '' }
    b.indicators = b.indicators.map((i) => ({ ...i, baseline: '', target: i.id === 'in2' ? '' : i.target }))
    expect(judged(p, '2')).toMatchObject({ result: 'warn', note: 'Verweis fehlt: Frage 2 „Frage fq2?“', target: { field: 'refs' } })
    expect(judged(p, '3')).toMatchObject({ note: 'Grund fehlt: Frage 2 „Frage fq2?“ (und 1 weitere)', target: { field: 'reasons' } })
    expect(judged(p, '11')).toMatchObject({ note: 'Ausgangswert fehlt: Indikator „Indikator in1“ (und 2 weitere)', target: { collection: 'indicators', id: 'in1', field: 'baseline' } })
    expect(judged(p, '12')).toMatchObject({ note: 'Zielwert fehlt: Indikator „Indikator in2“' })
  })

  it('criterion 4: open candidates first, then deferrals without a reason; Claude’s note follows the app’s', () => {
    let p = add5(project(), 'deferredCandidates', { linkId: 'li4', reason: '' })
    expect(judged(p, '4')).toMatchObject({ note: 'Zurückgestellt ohne Grund: „Annahme li4“', target: { collection: 'deferredCandidates', id: 'dc1', field: 'reason' } })
    const results = withAppJudged(5, block(p), [{ criterion: '4', result: 'warn', note: 'Der Lernwunsch aus Schritt 0 fehlt.' }], p)
    expect(results[0].note).toBe('Zurückgestellt ohne Grund: „Annahme li4“\nDer Lernwunsch aus Schritt 0 fehlt.')
    p = reducer(p, { type: 'item/edit', step: 5, collection: 'deferredCandidates', id: 'dc1', fields: { reason: 'läuft seit Jahren' } })
    expect(withAppJudged(5, block(p), [{ criterion: '4', result: 'ok', note: 'Lernwünsche sind drin.' }], p)[0]).toEqual({ criterion: '4', result: 'ok', note: 'Lernwünsche sind drin.' })
  })

  it('criterion 4 points to an open candidate before an earlier one deferred without a reason', () => {
    let p = project()
    p.steps[5].block.focusQuestions[0] = { ...p.steps[5].block.focusQuestions[0], linkIds: [], goalIds: ['go1'] }
    p = add5(p, 'deferredCandidates', { linkId: 'li1', reason: '' })
    expect(judged(p, '4')).toMatchObject({ note: 'Kandidat noch offen: „Annahme li4“ (und 1 weitere)', target: { collection: 'candidates', id: 'li4' } })
  })

  it('Claude may leave out what the app owns; criterion 4 stays his', () => {
    expect(appOwned(5).sort()).toEqual(['1', '11', '12', '13', '2', '3', '5', '6'])
  })
})

describe('two focus groups', () => {
  it('the cue names a group no question tests (only once there are questions)', () => {
    const p = project()
    expect(uncoveredGroups(p, block(p)).map((g) => g.id)).toEqual(['tg2'])
    p.steps[5].block.focusQuestions[1].goalIds = ['go3']
    expect(uncoveredGroups(p, block(p))).toEqual([])
    p.steps[5].block.focusQuestions = []
    expect(uncoveredGroups(p, block(p))).toEqual([])
  })
})
