// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toProposal } from '../../../src/ai/proposal'
import { operatingRules } from '../../../src/ai/rules'
import { proposeInput } from '../../../src/ai/tools'
import { stepOf, type LooseBlock } from '../../../src/domain/block'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { applyAll, changeView } from '../../../src/domain/proposals'
import { projectSchema, type Project, type Proposal } from '../../../src/domain/schemas/project'
import { rowText } from '../../../src/ui/proposals/describe'

// Step 6 proposals (implementation plan step 20): what the app refuses back to Claude, a whole
// plan in one proposal, and how a card names a plan row (by what it covers, never a row number
// or an id).

function project(): Project {
  const p = makeProject()
  p.steps[5].block = {
    focusQuestions: [makeItem(5, 'focusQuestions', { text: 'Bleiben die Ehrenamtlichen dabei?', reasons: ['kritische_annahme'], audience: 'Vorstand', linkIds: [], goalIds: [], why: 'w' }, { id: 'fq1' })],
    deferredCandidates: [],
    indicators: [
      makeItem(5, 'indicators', { focusQuestionId: 'fq1', level: 1, text: 'Öffnungstage, an denen beide Ehrenamtlichen da waren', baseline: 'ab jetzt', target: '20 von 24', why: 'w' }, { id: 'in1' }),
      makeItem(5, 'indicators', { focusQuestionId: 'fq1', level: 2, text: 'Zahl der Ehrenamtlichen im Winter', baseline: 'nachträglich', target: '4', why: 'w' }, { id: 'in2' }),
      makeItem(5, 'indicators', { focusQuestionId: 'fq9', level: 2, text: 'verwaist', baseline: '', target: '', why: '' }, { id: 'in9' }),
    ],
    mandatoryFigures: [makeItem(5, 'mandatoryFigures', { name: 'Teilnehmende nach Geschlecht', target: '120', unit: 'Personen' }, { id: 'mf1' })],
  }
  p.steps[6].block = {
    planRows: [
      makeItem(6, 'planRows', { indicatorIds: ['in1'], mandatoryFigureIds: [], dataSource: 'Anwesenheitsliste', method: 'nachlesen', collector: 'Teamleitung', frequency: 'jeden Monat', firstCollection: 'März', consentNote: 'entfällt', analysis: 'Team', why: 'gibt es schon' }, { id: 'pr1' }),
    ],
  }
  p.idCounters = { ...p.idCounters, fq: 1, in: 9, mf: 1, pr: 1 }
  return projectSchema.parse(p)
}

const meta = (p: Project) => ({
  seen: structuredClone(stepOf(p, 6).block),
  toolUseId: 'toolu_1',
  proposalId: 'p1',
  at: '2026-11-10T10:00:00.000Z',
  step5: p.steps[5].block as unknown as LooseBlock,
})
const rowFields = (fields: Record<string, unknown> = {}) => ({
  indicatorIds: [],
  mandatoryFigureIds: [],
  dataSource: 'Kurzbefragung',
  method: 'fragen: 3 Fragen am Ende des Halbjahrs',
  collector: 'Honorarkraft',
  frequency: 'zum Halbjahr und zum Ende',
  firstCollection: 'Februar',
  consentNote: 'anonym, Eltern informiert',
  analysis: 'Teamleitung im Teamtreffen',
  why: 'w',
  ...fields,
})
const run = (p: Project, changes: unknown[]) => toProposal(6, { summary: 'Plan.', question: 'Passt das?', changes }, meta(p))
const errors = (p: Project, changes: unknown[]) => {
  const r = run(p, changes)
  return r.ok ? [] : r.errors
}
const proposalOf = (p: Project, changes: unknown[]): Proposal => {
  const r = run(p, changes)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.proposal
}
const add = (n: number, fields: Record<string, unknown>) => ({ op: 'add', collection: 'planRows', id: `new:${n}`, fields: rowFields(fields) })

describe('tool rules (refused back to Claude)', () => {
  it('the schema has the seven fields, both reference lists and the Why', () => {
    const options = (proposeInput(6).shape.changes.element as unknown as { options: { shape: Record<string, { shape?: Record<string, unknown> }> }[] }).options
    const fields = options.find((o) => (o.shape.collection as unknown as { value: string }).value === 'planRows')!.shape.fields.shape!
    expect(Object.keys(fields).sort()).toEqual(['analysis', 'collector', 'consentNote', 'dataSource', 'firstCollection', 'frequency', 'indicatorIds', 'mandatoryFigureIds', 'method', 'why'])
  })

  it('a row names at least one reference', () => {
    expect(errors(project(), [add(1, {})])).toEqual([
      'Änderung 1: Jede Planzeile gehört zu mindestens einem Indikator (indicatorIds) oder einer Pflichtangabe (mandatoryFigureIds) aus Schritt 5.',
    ])
  })

  it('references are existing indicators of a question, or mandatory figures; none twice', () => {
    expect(errors(project(), [add(1, { indicatorIds: ['in7', 'in9'], mandatoryFigureIds: ['in1'] })])).toEqual([
      'Änderung 1: indicatorIds "in7" ist kein Indikator einer Lernfrage aus Schritt 5.',
      'Änderung 1: indicatorIds "in9" ist kein Indikator einer Lernfrage aus Schritt 5.',
      'Änderung 1: mandatoryFigureIds "in1" ist keine Pflichtangabe aus Schritt 5.',
    ])
    expect(errors(project(), [add(1, { indicatorIds: ['in2', 'in2'] })])).toEqual(['Änderung 1: Ein Verweis steht doppelt in derselben Planzeile.'])
    // A figure's id in the indicator list is no indicator.
    expect(errors(project(), [add(1, { indicatorIds: ['mf1'] })])).toEqual(['Änderung 1: indicatorIds "mf1" ist kein Indikator einer Lernfrage aus Schritt 5.'])
  })

  it('an update never empties the references (an empty list never clears a filled field), so the row keeps its own', () => {
    const p = project()
    const prop = proposalOf(p, [{ op: 'update', collection: 'planRows', id: 'pr1', fields: rowFields({ indicatorIds: [] }) }])
    expect(prop.changes[0].fields).not.toHaveProperty('indicatorIds')
  })

  it('a whole plan in one proposal applies; rows have no limit', () => {
    const p = project()
    const prop = proposalOf(p, [add(1, { indicatorIds: ['in2'] }), add(2, { mandatoryFigureIds: ['mf1'] }), add(3, { indicatorIds: ['in1', 'in2'] })])
    p.steps[6].proposals = [prop]
    const done = applyAll(p, 6, 'p1')
    expect(done.steps[6].block.planRows.map((r) => r.id)).toEqual(['pr1', 'pr2', 'pr3', 'pr4'])
  })
})

describe('operating rules', () => {
  it('step 6: fields, the plan in the card (never a table in the text), the app’s criteria', () => {
    const rules = operatingRules(6, 'system')
    expect(rules).toContain('## Schritt 6 in der App')
    expect(rules).toContain('nie als Tabelle im Chat-Text')
    expect(rules).toContain('„entfällt, keine Angaben von Personen“')
    expect(rules).toContain('Die Kriterien 1, 2, 3, 6, 9 und 10 prüft die App selbst')
    expect(operatingRules(5, 'system')).not.toContain('## Schritt 6 in der App')
  })
})

describe('card wording (never a row number, never an id)', () => {
  const row = (p: Project, prop: Proposal, i: number) => {
    p.steps[6].proposals = [prop]
    return rowText(p, 6, prop, prop.changes[i], changeView(p, 6, prop.id, prop.changes[i].id))
  }

  it('NEU: named by what it covers ("und" for two, "+ n weitere" past two), meta = the four facts', () => {
    const p = project()
    const prop = proposalOf(p, [add(1, { indicatorIds: ['in1'], mandatoryFigureIds: ['mf1'] }), add(2, { indicatorIds: ['in1', 'in2'], mandatoryFigureIds: ['mf1'] })])
    expect(row(p, prop, 0)).toMatchObject({
      kind: 'new',
      noun: 'Planzeile',
      main: 'für „Öffnungstage, an denen beide …“ und Pflichtangabe „Teilnehmende nach Geschlecht“',
      meta: ['Kurzbefragung · fragen: 3 Fragen am Ende des Halbjahrs · Honorarkraft · zum Halbjahr und zum Ende'],
    })
    expect(row(p, prop, 0).fields.map((f) => f.label)).toEqual(['Erster Termin', 'Einwilligung und Datenschutz', 'Auswertung und Nutzung', 'Warum?'])
    expect(row(p, prop, 1).main).toBe('für „Öffnungstage, an denen beide …“, „Zahl der Ehrenamtlichen im Winter“ + 1 weitere')
  })

  it('ÄNDERN names the row by its references and shows one line per field, the references as one "für" line', () => {
    const p = project()
    const prop = proposalOf(p, [
      { op: 'update', collection: 'planRows', id: 'pr1', fields: { ...rowFields(), indicatorIds: ['in1', 'in2'], dataSource: 'Anwesenheitsliste', method: 'nachlesen', collector: 'Honorarkraft', frequency: 'jeden Monat', firstCollection: 'März', consentNote: 'entfällt', analysis: 'Team', why: 'gibt es schon' } },
    ])
    const r = row(p, prop, 0)
    expect(r.main).toBe('für „Öffnungstage, an denen beide …“')
    expect(r.fields).toEqual([
      { label: 'für', before: '„Öffnungstage, an denen beide …“', after: '„Öffnungstage, an denen beide …“ und „Zahl der Ehrenamtlichen im Winter“' },
      { label: 'Wer erhebt', before: 'Teamleitung', after: 'Honorarkraft' },
    ])
    expect(JSON.stringify(r)).not.toMatch(/\b(pr|in|mf)\d/)
  })
})
