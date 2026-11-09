// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LooseBlock } from '../../../src/domain/block'
import { activityUse, chainItems, chainOf, incomplete, linkState, skippedLevels, unlinked } from '../../../src/domain/chain'
import { appJudged, appOwned, confirmStep, hardIssues, issueContext, withAppJudged } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project, type QualityCheck } from '../../../src/domain/schemas/project'
import { isHidden, panelGroupOf, stepGroups } from '../../../src/domain/tree'
import { gateView } from '../../../src/ui/check/gate'

// Step 4 domain (implementation plan step 18, design §6.2 "Step 18"): chain order (never hangs on
// bad data), the ⛔ rules, the app's own ⚠ for critical assumptions and incomplete links.

const AT = '2026-11-09T10:00:00.000Z'
const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const goal = (id: string, groupId: string, level: 4 | 5 | 6, text: string) => makeItem(3, 'goals', { groupId, level, text, causeIds: [], timeFrame: 'bis 2027', why: 'nötig' }, { id })
const output = (id: string, groupId: string, level: 1 | 2 | 3, text: string) => makeItem(4, 'outputs', { groupId, level, text }, { id })
const link = (id: string, fromId: string, toId: string, fields: Record<string, unknown> = {}) =>
  makeItem(4, 'links', { groupId: 'tg1', fromId, toId, because: 'weil es so wirkt', assumption: 'Sie kommen regelmäßig', evidence: 'unsicher', critical: false, ...fields }, { id })

/** tg1 focus with a straight chain ac1 → ou1 → ou2 → ou3 → go1 → go2 → go3 (stored shuffled), tg2 non-focus. */
function project(): Project {
  const p = makeProject({ steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche'), group('tg2', false, 'Eltern')] } } } })
  p.steps[3].block = {
    goals: [goal('go1', 'tg1', 4, 'Sie wissen, wie ein Rad funktioniert'), goal('go2', 'tg1', 5, 'Sie reparieren selbst'), goal('go3', 'tg1', 6, 'Sie sind mobil')],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: 'Das Projekt trägt dazu bei, dass …', why: 'x' }, { id: 'level7' }),
  }
  p.steps[4].block = {
    resources: [makeItem(4, 'resources', { text: 'Zwei Ehrenamtliche' }, { id: 'rs1' })],
    activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt', why: 'damit sie schrauben' }, { id: 'ac1' })],
    outputs: [output('ou1', 'tg1', 1, 'Werkstatt hat zweimal pro Woche offen'), output('ou2', 'tg1', 2, '15 Jugendliche kommen'), output('ou3', 'tg1', 3, 'Sie kommen gern wieder')],
    links: [link('li4', 'ou3', 'go1'), link('li1', 'ac1', 'ou1'), link('li6', 'go2', 'go3'), link('li3', 'ou2', 'ou3'), link('li2', 'ou1', 'ou2'), link('li5', 'go1', 'go2')],
    externalFactors: [],
    sideEffects: [],
  }
  p.idCounters = { ...p.idCounters, tg: 2, go: 3, rs: 1, ac: 1, ou: 3, li: 6 }
  return projectSchema.parse(p)
}

const block = (p: Project) => p.steps[4].block as unknown as LooseBlock
const issues = (p: Project) => hardIssues(4, block(p), ...issueContext(p))
const edit = (p: Project, collection: string, id: string, fields: Record<string, unknown>) => reducer(p, { type: 'item/edit', step: 4, collection, id, fields })
const ids = (list: { id: string }[]) => list.map((i) => i.id)

describe('chain order', () => {
  it('sorts by the start’s level, then the end’s, then list order — never stored', () => {
    const p = project()
    expect(ids(chainOf(chainItems(p), block(p).links as never, 'tg1'))).toEqual(['li1', 'li2', 'li3', 'li4', 'li5', 'li6'])
    expect(ids(p.steps[4].block.links)).toEqual(['li4', 'li1', 'li6', 'li3', 'li2', 'li5'])
  })

  it('a link to itself or a loop doesn’t hang the ordering; every row appears once and none is "upward"', () => {
    const p = project()
    p.steps[4].block.links.push(link('li7', 'ou2', 'ou2'), link('li8', 'ou3', 'ou2'), link('li9', 'ou2', 'ou3'))
    const items = chainItems(p)
    const chain = chainOf(items, p.steps[4].block.links as never, 'tg1')
    expect(chain).toHaveLength(9)
    expect(new Set(ids(chain)).size).toBe(9)
    expect(incomplete(items, chain.find((l) => l.id === 'li7')!)).toBe(true)
    expect(incomplete(items, chain.find((l) => l.id === 'li8')!)).toBe(true)
  })

  it('an unknown or deleted end sorts last on its side and makes the link incomplete', () => {
    const p = project()
    p.steps[4].block.links.push(link('li7', '', 'ou2'), link('li8', 'ac9', 'ou1'))
    const items = chainItems(p)
    const chain = chainOf(items, p.steps[4].block.links as never, 'tg1')
    // Both starts unknown (99): then the end's level decides (ou1 before ou2).
    expect(ids(chain).slice(-2)).toEqual(['li8', 'li7'])
    expect(linkState(items, chain.at(-1)!)).toMatchObject({ fromMissing: true, toMissing: false, upward: false })
  })

  it('ends of another group never count (an output of tg2 is "gone" for tg1)', () => {
    const p = project()
    p.steps[4].block.outputs.push(output('ou4', 'tg2', 1, 'Elternabend'))
    expect(linkState(chainItems(p), link('li7', 'ac1', 'ou4'))).toMatchObject({ toMissing: true })
  })
})

describe('reading aids', () => {
  it('skippedLevels names filled, unmarked levels a link jumps over', () => {
    const p = project()
    const items = chainItems(p)
    expect(skippedLevels(items, link('li7', 'ac1', 'ou3'))).toEqual([1, 2])
    expect(skippedLevels(items, link('li7', 'go1', 'go3'))).toEqual([5])
    p.steps[3].block.levelNotApplicable.push(makeItem(3, 'levelNotApplicable', { groupId: 'tg1', level: 5, why: 'x' }, { id: 'na1' }))
    expect(skippedLevels(chainItems(p), link('li7', 'go1', 'go3'))).toEqual([])
  })

  it('unlinked lists outputs no link touches and goals no link reaches; activityUse names focus groups', () => {
    const p = reducer(project(), { type: 'item/remove', step: 4, collection: 'links', id: 'li5' })
    const u = unlinked(chainItems(p), p.steps[4].block.links as never, 'tg1')
    expect(ids(u.outputs)).toEqual([])
    expect(ids(u.goals)).toEqual(['go2'])
    expect(activityUse(p.steps[4].block.links as never, 'ac1', ['tg1'])).toEqual(['tg1'])
    expect(activityUse(p.steps[4].block.links as never, 'ac2', ['tg1'])).toEqual([])
  })
})

describe('groups in step 4', () => {
  it('a non-focus group’s outputs and links are hidden; external factors stay', () => {
    const groups = project().steps[1].block.targetGroups as never
    expect(isHidden(groups, 4, 'outputs', { groupId: 'tg2' })).toBe(true)
    expect(isHidden(groups, 4, 'links', { groupId: 'tg2' })).toBe(true)
    expect(isHidden(groups, 4, 'externalFactors', { groupId: 'tg2' })).toBe(false)
  })

  it('an external factor for all groups ("") is no orphan and sits in no group panel', () => {
    const p = project()
    p.steps[4].block.externalFactors.push(makeItem(4, 'externalFactors', { groupId: '', text: 'Wetter' }, { id: 'ef1' }), makeItem(4, 'externalFactors', { groupId: 'tg1', text: 'Schulzeiten' }, { id: 'ef2' }))
    expect(stepGroups(p, 4).orphans).toEqual([])
    expect(panelGroupOf(p, 4, 'ef1')).toBeUndefined()
    expect(panelGroupOf(p, 4, 'ef2')).toBeUndefined()
    expect(panelGroupOf(p, 4, 'li1')).toBe('tg1')
  })
})

describe('step 4 ⛔ rules', () => {
  it('a complete block has none', () => {
    expect(issues(project())).toEqual([])
  })

  it('criterion 4: a link without "weil" → Zum Feld goes to it; criterion 5 likewise for the assumption', () => {
    let p = edit(project(), 'links', 'li2', { because: '' })
    p = edit(p, 'links', 'li5', { assumption: ' ' })
    expect(issues(p)).toEqual([
      { criterion: '4', text: '„weil“ fehlt: „Werkstatt hat zweimal pro …“ → „15 Jugendliche kommen“ · Jugendliche', target: { collection: 'links', id: 'li2', field: 'because', group: 'tg1' } },
      { criterion: '5', text: 'Annahme fehlt: „Sie wissen, wie ein Rad …“ → „Sie reparieren selbst“ · Jugendliche', target: { collection: 'links', id: 'li5', field: 'assumption', group: 'tg1' } },
    ])
  })

  it('a link with a missing end is named with „?“', () => {
    const p = reducer(project(), { type: 'item/add', step: 4, collection: 'links', fields: { groupId: 'tg1', fromId: 'ac1', toId: '', evidence: 'unsicher', critical: false } })
    expect(issues(p).map((i) => i.text)).toEqual(['„weil“ fehlt: „Offene Werkstatt“ → „?“ · Jugendliche', 'Annahme fehlt: „Offene Werkstatt“ → „?“ · Jugendliche'])
  })

  it('criterion 11: an activity without Why; activities come before the chains', () => {
    let p = edit(project(), 'activities', 'ac1', { why: '' })
    p = edit(p, 'links', 'li1', { because: '' })
    expect(issues(p).map((i) => i.criterion)).toEqual(['11', '4'])
    expect(issues(p)[0]).toEqual({ criterion: '11', text: 'Warum fehlt: Aktivität „Offene Werkstatt“', target: { collection: 'activities', id: 'ac1', field: 'why' } })
  })

  it('links of a non-focus group count for nothing', () => {
    const p = project()
    p.steps[4].block.links.push({ ...link('li7', 'ac1', 'ou9', { because: '', assumption: '' }), groupId: 'tg2' })
    expect(issues(p)).toEqual([])
  })

  it('no focus group: one row that leads to step 1', () => {
    const p = project()
    p.steps[1].block.targetGroups[0].isFocus = false
    expect(issues(p)).toEqual([{ criterion: '1', text: 'Wähle in Schritt 1 eine oder zwei Fokusgruppen', target: { collection: 'targetGroups', field: 'isFocus', step: 1 } }])
  })

  it('confirming is refused while a ⛔ holds', () => {
    let p = edit(project(), 'links', 'li1', { because: '' })
    const check: QualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[4].block), results: [] }
    p = reducer(p, { type: 'check/store', step: 4, check })
    expect(confirmStep(p, 4, AT).steps[4].status).not.toBe('confirmed')
  })
})

describe('step 4 app-judged ⚠', () => {
  const claude = (r1: 'ok' | 'warn', note1 = 'Kette passt.'): QualityCheck['results'] => [
    { criterion: '1', result: r1, note: note1 },
    { criterion: '6', result: 'ok', note: 'passt' },
  ]

  it('Claude may leave out 6 and 11; 1, 4 and 5 stay Claude’s too (shared)', () => {
    expect(appOwned(4)).toEqual(['11', '6'])
  })

  it('criterion 6: a third critical assumption in a group is ⚠, Zum Feld to the third box', () => {
    let p = project()
    for (const id of ['li2', 'li4']) p = edit(p, 'links', id, { critical: true })
    expect(appJudged(4, block(p), p).find((j) => j.criterion === '6')).toMatchObject({ result: 'ok' })
    p = edit(p, 'links', 'li5', { critical: true })
    expect(appJudged(4, block(p), p).find((j) => j.criterion === '6')).toEqual({
      criterion: '6',
      result: 'warn',
      note: '3 kritische Annahmen · Jugendliche – höchstens 2',
      // chain order: li2, li4, li5
      target: { collection: 'links', id: 'li5', field: 'critical', group: 'tg1' },
    })
  })

  it('criterion 1 is judged by both: the app’s incomplete link first, Claude’s ⚠ note after it', () => {
    const ok = project()
    expect(withAppJudged(4, block(ok), claude('warn', 'Stufe 2 fehlt.'), ok)[0]).toEqual({ criterion: '1', result: 'warn', note: 'Stufe 2 fehlt.' })
    expect(withAppJudged(4, block(ok), claude('ok'), ok)[0]).toEqual({ criterion: '1', result: 'ok', note: 'Kette passt.' })
    const p = reducer(ok, { type: 'item/remove', step: 4, collection: 'outputs', id: 'ou2' })
    expect(withAppJudged(4, block(p), claude('ok'), p)[0]).toEqual({
      criterion: '1',
      result: 'warn',
      note: 'Verbindung unvollständig: „Werkstatt hat zweimal pro …“ → „?“ · Jugendliche (und 1 weitere)',
    })
    expect(withAppJudged(4, block(p), claude('warn', 'Stufe 2 fehlt.'), p)[0].note).toMatch(/\(und 1 weitere\)\nStufe 2 fehlt\.$/)
  })

  it('the gate keeps Claude’s stored ⚠ for criterion 1 when the app finds nothing now, and adds Zum Feld when it does', () => {
    let p = project()
    const store = (results: QualityCheck['results']) => reducer(p, { type: 'check/store', step: 4, check: { at: AT, source: 'app', block: structuredClone(p.steps[4].block), results } })
    p = store(claude('warn', 'Stufe 2 fehlt.'))
    const row = gateView(p, 4).warn.find((r) => r.criterion === '1')!
    expect(row).toMatchObject({ result: 'warn', note: 'Stufe 2 fehlt.' })
    expect(row.target).toBeUndefined()
    p = reducer(p, { type: 'item/remove', step: 4, collection: 'outputs', id: 'ou2' })
    p = store(claude('ok'))
    expect(gateView(p, 4).warn.find((r) => r.criterion === '1')).toMatchObject({ target: { collection: 'links', id: 'li2', field: 'ends', group: 'tg1' } })
  })
})
