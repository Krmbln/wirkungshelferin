// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toProposal } from '../../../src/ai/proposal'
import { operatingRules } from '../../../src/ai/rules'
import { proposeInput } from '../../../src/ai/tools'
import { stepOf } from '../../../src/domain/block'
import { groupsOf } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { changeView } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import { rowText, staleText } from '../../../src/ui/proposals/describe'

// Step 2 proposals (implementation plan step 16): what the app refuses back to Claude, and how
// a card names groups, levels and moved children.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })

function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche 12–17'), group('tg2', false, 'Eltern')] } } },
  })
  p.steps[2].block = {
    problems: [makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Sie schaffen selten etwas selbst.', why: 'erzählt' }, { id: 'pb1' })],
    causes: [
      makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Kein eigenes Rad', why: 'gesehen' }, { id: 'ca1' }),
      makeItem(2, 'causes', { groupId: 'tg1', parentId: 'ca1', text: 'Reparaturen sind teuer', why: 'gesehen' }, { id: 'ca2' }),
    ],
    consequences: [
      makeItem(2, 'consequences', { groupId: 'tg1', parentId: '', text: 'Wenig Zutrauen' }, { id: 'co1' }),
      makeItem(2, 'consequences', { groupId: 'tg1', parentId: 'co1', text: 'Weniger Ausbildung' }, { id: 'co2' }),
    ],
  }
  p.idCounters = { ...p.idCounters, tg: 2, pb: 1, ca: 2, co: 2 }
  return projectSchema.parse(p)
}

const causeFields = (fields: Record<string, unknown>) => ({ groupId: 'tg1', parentId: '', text: 'neu', evidence: 'unsicher', notInfluenceable: false, why: '', ...fields })
const meta = (p: Project) => ({ seen: structuredClone(stepOf(p, 2).block), toolUseId: 'toolu_1', proposalId: 'p1', at: '2026-11-09T10:00:00.000Z', groups: groupsOf(p) })
const run = (p: Project, changes: unknown[]) => toProposal(2, { summary: 'Baum ergänzt.', changes }, meta(p))
const errors = (p: Project, changes: unknown[]) => {
  const r = run(p, changes)
  return r.ok ? [] : r.errors
}

describe('step 2 proposals: what the app refuses back to Claude', () => {
  it('the tool schema carries parentId (strict: required, "" = direct)', () => {
    const ok = proposeInput(2).safeParse({ summary: 's', changes: [{ op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({}) }] })
    expect(ok.success).toBe(true)
    const missing = proposeInput(2).safeParse({ summary: 's', changes: [{ op: 'add', collection: 'causes', id: 'new:1', fields: { ...causeFields({}), parentId: undefined } }] })
    expect(missing.success).toBe(false)
  })

  it('accepts a cause under a cause created in the same proposal', () => {
    const p = project()
    const r = run(p, [
      { op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ text: 'A' }) },
      { op: 'add', collection: 'causes', id: 'new:2', fields: causeFields({ text: 'B', parentId: 'new:1' }) },
    ])
    expect(r.ok).toBe(true)
  })

  it('refuses a group that is not in step 1, causes for a non-focus group and a second core problem', () => {
    const p = project()
    expect(errors(p, [{ op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ groupId: 'tg9' }) }])).toEqual(['Änderung 1: groupId "tg9" ist keine Zielgruppe aus Schritt 1.'])
    expect(errors(p, [{ op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ groupId: 'tg2' }) }])[0]).toMatch(/„Eltern“ ist keine Fokusgruppe/)
    expect(errors(p, [{ op: 'add', collection: 'problems', id: 'new:1', fields: { groupId: 'tg1', coreProblem: 'Zweites', why: '' } }])[0]).toMatch(/hat schon ein Kernproblem/)
    // A non-focus group's core problem is fine.
    expect(run(p, [{ op: 'add', collection: 'problems', id: 'new:1', fields: { groupId: 'tg2', coreProblem: 'Eltern wissen wenig.', why: '' } }]).ok).toBe(true)
  })

  it('refuses a fourth level, a parent from another list or group, and a move that pushes children too deep', () => {
    const p = project()
    expect(errors(p, [{ op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ parentId: 'ca2' }) }])).toEqual([])
    expect(
      errors(p, [
        { op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ parentId: 'ca2' }) },
        { op: 'add', collection: 'causes', id: 'new:2', fields: causeFields({ parentId: 'new:1' }) },
      ]),
    ).toContain('Änderung 2: höchstens 3 Ebenen (direkt, darunter, darunter).')
    expect(errors(p, [{ op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ parentId: 'co1' }) }])[0]).toMatch(/parentId "co1" gibt es in „causes“ nicht/)
    // ca1 (with a child) under a new cause under ca2? ca1 → depth 3 + child = 4.
    const deep = errors(p, [
      { op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ text: 'oben' }) },
      { op: 'add', collection: 'causes', id: 'new:2', fields: causeFields({ text: 'mitte', parentId: 'new:1' }) },
      { op: 'update', collection: 'causes', id: 'ca1', fields: { ...causeFields({ text: 'Kein eigenes Rad', why: 'gesehen' }), parentId: 'new:2' } },
    ])
    expect(deep).toContain('Änderung 3: höchstens 3 Ebenen (direkt, darunter, darunter).')
  })
})

describe('step 2 card wording', () => {
  function rows(p: Project, changes: unknown[]) {
    const r = run(p, changes)
    if (!r.ok) throw new Error(r.errors.join('; '))
    p.steps[2].proposals = [r.proposal]
    return r.proposal.changes.map((c) => rowText(p, 2, r.proposal, c, changeView(p, 2, r.proposal.id, c.id)))
  }

  it('names the group in the noun line, the evidence always and the parent on a NEU row; never an id', () => {
    const p = project()
    const [a, b] = rows(p, [
      { op: 'add', collection: 'causes', id: 'new:1', fields: causeFields({ text: 'Eltern arbeiten nachmittags', parentId: 'ca1', notInfluenceable: true }) },
      { op: 'add', collection: 'causes', id: 'new:2', fields: causeFields({ text: 'Darunter', parentId: 'new:1' }) },
    ])
    expect(a).toMatchObject({ kind: 'new', noun: 'Ursache · Jugendliche 12–17', main: 'Eltern arbeiten nachmittags', meta: ['unsicher', 'nicht beeinflussbar', 'unter „Kein eigenes Rad“'] })
    expect(b.meta).toEqual(['unsicher', 'unter „Eltern arbeiten nachmittags“'])
    expect(JSON.stringify([a, b])).not.toMatch(/tg1|ca1|new:1/)
  })

  it('a moved cause reads old → new placement; ENTFERNEN says how many move up', () => {
    const p = project()
    const [move, remove] = rows(p, [
      { op: 'update', collection: 'causes', id: 'ca2', fields: { ...causeFields({ text: 'Reparaturen sind teuer', why: 'gesehen' }), parentId: '' } },
      { op: 'remove', collection: 'consequences', id: 'co1' },
    ])
    expect(move.fields).toEqual([{ label: 'Einordnung', before: 'unter „Kein eigenes Rad“', after: 'direkte Ursache' }])
    expect(remove).toMatchObject({ kind: 'remove', noun: 'Folge · Jugendliche 12–17', main: 'Wenig Zutrauen', meta: ['1 Folge darunter rückt eine Ebene hoch'] })
  })

  it('a row for a group that is no longer a focus group says why it is stale', () => {
    const p = project()
    const r = run(p, [{ op: 'update', collection: 'causes', id: 'ca1', fields: causeFields({ text: 'anders', why: 'gesehen' }) }])
    if (!r.ok) throw new Error()
    p.steps[2].proposals = [r.proposal]
    const unmarked = reducer(p, { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { isFocus: false } })
    const view = changeView(unmarked, 2, 'p1', 'p1c1')
    expect(view).toEqual({ kind: 'stale', reason: 'hidden' })
    expect(staleText(unmarked, 2, r.proposal, r.proposal.changes[0], 'hidden')).toBe('gehört zu einer Gruppe, die keine Fokusgruppe mehr ist')
  })
})

describe('step 2 operating rules', () => {
  it('explain groups, one core problem, levels and evidence; criterion 9 belongs to the app', () => {
    const rules = operatingRules(2, 'text')
    expect(rules).toContain('## Schritt 2 in der App')
    expect(rules).toMatch(/groupId/)
    expect(rules).toMatch(/Ein Kernproblem pro Gruppe/)
    expect(rules).toMatch(/Höchstens drei Ebenen/)
    expect(rules).toMatch(/Kriterium 9/)
    expect(operatingRules(1, 'text')).not.toContain('Schritt 2 in der App')
  })
})
