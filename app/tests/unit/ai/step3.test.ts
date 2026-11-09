// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toProposal } from '../../../src/ai/proposal'
import { operatingRules } from '../../../src/ai/rules'
import { stepOf, type LooseBlock } from '../../../src/domain/block'
import { groupsOf } from '../../../src/domain/check'
import { makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { changeView } from '../../../src/domain/proposals'
import { projectSchema, type Project } from '../../../src/domain/schemas/project'
import { blockedText, rowText } from '../../../src/ui/proposals/describe'

// Step 3 proposals (implementation plan step 17): what the app refuses back to Claude, and how a
// card names levels, links and marks.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })

function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche 12–17'), group('tg2', true, 'Mädchen'), group('tg3', false, 'Eltern')] } } },
  })
  p.steps[2].block = {
    problems: [
      makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Sie schaffen selten etwas selbst.', why: 'erzählt' }, { id: 'pb1' }),
      makeItem(2, 'problems', { groupId: 'tg3', coreProblem: 'Eltern wissen wenig.', why: 'erzählt' }, { id: 'pb3' }),
    ],
    causes: [
      makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Viele haben kein funktionierendes Rad und kommen kaum raus', why: 'gesehen' }, { id: 'ca1' }),
      makeItem(2, 'causes', { groupId: 'tg1', parentId: 'ca1', text: 'Reparaturen sind teuer', why: 'gesehen' }, { id: 'ca2' }),
      makeItem(2, 'causes', { groupId: 'tg2', parentId: '', text: 'Werkstätten gelten als Ort für Jungen', why: 'gesehen' }, { id: 'ca3' }),
    ],
    consequences: [],
  }
  p.steps[3].block = {
    goals: [makeItem(3, 'goals', { groupId: 'tg1', level: 5, text: 'Sie reparieren ihr Rad selbst.', causeIds: ['ca2'], timeFrame: 'bis 2027', why: '' }, { id: 'go1' })],
    levelNotApplicable: [makeItem(3, 'levelNotApplicable', { groupId: 'tg1', level: 6, why: 'nichts' }, { id: 'na1' })],
    level7: makeItem(3, 'level7', { text: '', why: '' }, { id: 'level7' }),
  }
  p.idCounters = { ...p.idCounters, tg: 3, pb: 3, ca: 3, go: 1, na: 1 }
  return projectSchema.parse(p)
}

const goalFields = (fields: Record<string, unknown>) => ({ groupId: 'tg1', level: 4, text: 'Sie können flicken.', causeIds: ['ca1'], timeFrame: '', why: '', ...fields })
const meta = (p: Project) => ({
  seen: structuredClone(stepOf(p, 3).block),
  toolUseId: 'toolu_1',
  proposalId: 'p1',
  at: '2026-11-09T10:00:00.000Z',
  groups: groupsOf(p),
  step2: p.steps[2].block as unknown as LooseBlock,
})
const run = (p: Project, changes: unknown[]) => toProposal(3, { summary: 'Ziele.', question: 'Passt das so?', changes }, meta(p))
const errors = (p: Project, changes: unknown[]) => {
  const r = run(p, changes)
  return r.ok ? [] : r.errors
}

describe('step 3 proposals refused back to Claude', () => {
  it('a focus goal links only to causes of its own group', () => {
    expect(errors(project(), [{ op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ causeIds: ['ca1', 'ca2'] }) }])).toEqual([])
    expect(errors(project(), [{ op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ causeIds: ['ca3'] }) }])[0]).toMatch(
      /causeIds "ca3" ist keine Ursache von „Jugendliche 12–17“ aus Schritt 2/,
    )
    expect(errors(project(), [{ op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ causeIds: ['ca9'] }) }])[0]).toMatch(/lässt du weg/)
  })

  it('a non-focus goal has causeIds [] (its core problem is linked by the app)', () => {
    expect(errors(project(), [{ op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ groupId: 'tg3', causeIds: [] }) }])).toEqual([])
    expect(errors(project(), [{ op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ groupId: 'tg3', causeIds: ['ca1'] }) }])[0]).toMatch(
      /die App verknüpft ihre Ziele selbst mit ihrem Kernproblem – causeIds ist \[\]/,
    )
  })

  it('marks only for focus groups', () => {
    expect(errors(project(), [{ op: 'add', collection: 'levelNotApplicable', id: 'new:1', fields: { groupId: 'tg3', level: 4, why: 'x' } }])[0]).toMatch(/keine Fokusgruppe/)
  })

  it('a goal on a marked level needs the removal of the mark in the same proposal', () => {
    const add = { op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ level: 6 }) }
    expect(errors(project(), [add])[0]).toMatch(/Stufe 6 ist für „Jugendliche 12–17“ als „trifft nicht zu“ markiert \(na1\)/)
    expect(errors(project(), [add, { op: 'remove', collection: 'levelNotApplicable', id: 'na1' }])).toEqual([])
  })

  it('a second mark for a level, or a mark on a level with goals', () => {
    expect(errors(project(), [{ op: 'add', collection: 'levelNotApplicable', id: 'new:1', fields: { groupId: 'tg1', level: 6, why: 'x' } }])[0]).toMatch(/schon als „trifft nicht zu“/)
    expect(errors(project(), [{ op: 'add', collection: 'levelNotApplicable', id: 'new:1', fields: { groupId: 'tg1', level: 5, why: 'x' } }])[0]).toMatch(/hat für „Jugendliche 12–17“ schon Ziele/)
  })
})

describe('step 3 card wording', () => {
  const card = (changes: unknown[]) => {
    const r = run(project(), changes)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const p = project()
    p.steps[3].proposals = [r.proposal]
    return r.proposal.changes.map((c) => rowText(p, 3, r.proposal, c, changeView(p, 3, r.proposal.id, c.id)))
  }

  it('NEU goal: level and group in the noun, time frame and links on the meta line, never an id', () => {
    const [row] = card([{ op: 'add', collection: 'goals', id: 'new:1', fields: goalFields({ causeIds: ['ca1', 'ca2'], timeFrame: 'bis zum Sommer', why: 'damit' }) }])
    expect(row.noun).toBe('Ziel · Stufe 4 · Jugendliche 12–17')
    expect(row.main).toBe('Sie können flicken.')
    expect(row.meta).toEqual(['bis zum Sommer · löst auf: „Viele haben kein funktionierendes Rad …“, „Reparaturen sind teuer“'])
    expect(row.fields).toEqual([{ label: 'Warum?', after: 'damit' }])
    expect(JSON.stringify(row)).not.toMatch(/ca\d|tg\d/)
  })

  it('ÄNDERN of links and level, in words', () => {
    const [row] = card([{ op: 'update', collection: 'goals', id: 'go1', fields: { groupId: 'tg1', level: 4, text: 'Sie reparieren ihr Rad selbst.', causeIds: ['ca1'], timeFrame: 'bis 2027', why: '' } }])
    expect(row.noun).toBe('Ziel · Stufe 5 · Jugendliche 12–17')
    expect(row.fields).toEqual([
      { label: 'Stufe', before: 'Stufe 5', after: 'Stufe 4' },
      { label: 'Löst auf', before: '„Reparaturen sind teuer“', after: '„Viele haben kein funktionierendes Rad …“' },
    ])
  })

  it('a mark is named in words, Stufe 7 has its own noun', () => {
    const [mark, level7] = card([
      { op: 'remove', collection: 'levelNotApplicable', id: 'na1' },
      { op: 'update', collection: 'level7', id: 'level7', fields: { text: 'Das Projekt trägt dazu bei, dass …', why: '' } },
    ])
    expect([mark.noun, mark.main]).toEqual(['Trifft nicht zu · Stufe 6 · Jugendliche 12–17', 'Trifft für „Jugendliche 12–17“ nicht zu'])
    expect(level7.noun).toBe('Stufe 7 · Beitrag')
  })

  it('a goal waiting for a removal names it by its noun, so no quotes nest: zuerst „Entfernen: …“ übernehmen', () => {
    const p = project()
    const proposal = makeProposal(
      [
        { op: 'add', collection: 'goals', tempId: 'new:1', fields: goalFields({ level: 6 }) },
        { op: 'remove', collection: 'levelNotApplicable', targetId: 'na1', baseRev: 1 },
      ],
      { id: 'p1' },
    )
    p.steps[3].proposals = [proposal]
    const view = changeView(p, 3, 'p1', 'p1c1')
    expect(view).toEqual({ kind: 'blocked', needs: 'p1c2' })
    expect(blockedText(p, 3, proposal, 'p1c2')).toBe('zuerst „Entfernen: Trifft nicht zu · Stufe 6“ übernehmen')
  })
})

describe('step 3 operating rules', () => {
  it('explain groups, links, marks and Stufe 7, and which criteria the app checks', () => {
    const rules = operatingRules(3, 'text')
    expect(rules).toContain('## Schritt 3 in der App')
    expect(rules).toContain('`causeIds: []`')
    expect(rules).toContain('Die Kriterien 4, 5, 6, 9 und 10 prüft die App selbst')
    expect(rules).toContain('Jeder Vorschlag')
  })

  it('every step names the link form for an earlier step', () => {
    for (const step of [1, 2, 3, 4] as const) expect(operatingRules(step, 'text')).toContain('`[Zu Schritt 2](#schritt-2)`')
  })
})
