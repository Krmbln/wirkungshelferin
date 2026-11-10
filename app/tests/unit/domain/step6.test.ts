// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { LooseBlock } from '../../../src/domain/block'
import { appJudged, appOwned, confirmStep, hardIssues, issueContext, withAppJudged } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { COVERAGE_KEY, allCovered, coverage, initialClosed, missingFields, needs, planRefsOf, rowName, summaryFacts } from '../../../src/domain/plan'
import { reducer } from '../../../src/domain/reducer'
import { panelGroupOf } from '../../../src/domain/tree'
import { projectSchema, type Project, type QualityCheck } from '../../../src/domain/schemas/project'

// Step 6 domain (implementation plan step 20, design §6.2 "Step 20"): what needs a plan row
// (derived from step 5), a row's references, the ⛔ rules (no reference, no Why), the app's own
// ⚠ (deleted references, coverage, missing fields) and the first closed state.

const AT = '2026-11-10T10:00:00.000Z'
const question = (id: string, text: string) => makeItem(5, 'focusQuestions', { text, reasons: ['eigenes_lernen'], audience: 'Vorstand', linkIds: [], goalIds: [], why: 'damit' }, { id })
const indicator = (id: string, focusQuestionId: string, text: string, baseline = 'ab jetzt') =>
  makeItem(5, 'indicators', { focusQuestionId, level: 5, text, baseline, target: 'die Hälfte', why: 'zeigt es' }, { id })
const figure = (id: string, name: string) => makeItem(5, 'mandatoryFigures', { name, target: '120', unit: 'Personen' }, { id })
const full = {
  dataSource: 'Teilnahmeliste',
  method: 'nachlesen',
  collector: 'Teamleitung',
  frequency: 'jeden Monat',
  firstCollection: 'März',
  consentNote: 'entfällt, keine Angaben von Personen',
  analysis: 'Teamleitung im Teamtreffen: weitermachen oder anpassen',
  why: 'Die Liste gibt es schon',
}
const row = (id: string, fields: Record<string, unknown> = {}) => makeItem(6, 'planRows', { indicatorIds: [], mandatoryFigureIds: [], ...full, ...fields }, { id })

/** fq1 has in1 + in2, fq2 has in3; figures mf1, mf2. pr1 covers in1 + in2, pr2 covers mf1. Uncovered: in3, mf2. */
function project(): Project {
  const p = makeProject()
  p.steps[5].block = {
    focusQuestions: [question('fq1', 'Bleiben die Ehrenamtlichen dabei?'), question('fq2', 'Reparieren sie selbst?')],
    deferredCandidates: [],
    // Out of question order on purpose: needs() follows the questions.
    indicators: [indicator('in3', 'fq2', 'Anteil, die selbst flicken'), indicator('in1', 'fq1', 'Öffnungstage mit beiden'), indicator('in2', 'fq1', 'Zahl der Ehrenamtlichen', ''), indicator('in9', 'fq9', 'verwaist')],
    mandatoryFigures: [figure('mf1', 'Teilnehmende nach Geschlecht'), figure('mf2', 'Anzahl Termine')],
  }
  p.steps[6].block = { planRows: [row('pr1', { indicatorIds: ['in1', 'in2'] }), row('pr2', { mandatoryFigureIds: ['mf1'] })] }
  p.idCounters = { ...p.idCounters, fq: 2, in: 9, mf: 2, pr: 2 }
  return projectSchema.parse(p)
}

const block6 = (p: Project) => p.steps[6].block as unknown as LooseBlock
const edit6 = (p: Project, id: string, fields: Record<string, unknown>) => reducer(p, { type: 'item/edit', step: 6, collection: 'planRows', id, fields })
const check = (p: Project): QualityCheck => ({
  at: AT,
  source: 'app',
  block: structuredClone(p.steps[6].block),
  results: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((criterion) => ({ criterion, result: 'ok' as const, note: 'Claude' })),
})

describe('what needs a plan row', () => {
  it('indicators by question, then mandatory figures; orphan indicators are left out', () => {
    expect(needs(project()).map((n) => n.item.id)).toEqual(['in1', 'in2', 'in3', 'mf1', 'mf2'])
  })

  it('coverage says which rows cover each, in row numbers', () => {
    const p = project()
    p.steps[6].block.planRows.push(row('pr3', { indicatorIds: ['in2'] }))
    expect(coverage(p).map((c) => [c.need.item.id, c.rows])).toEqual([
      ['in1', [1]],
      ['in2', [1, 3]],
      ['in3', []],
      ['mf1', [2]],
      ['mf2', []],
    ])
    expect(allCovered(p)).toBe(false)
  })

  it('is derived: a new indicator in step 5 needs a row at once, a covered one is done (the plan’s test, by data)', () => {
    let p = project()
    p = reducer(p, { type: 'item/add', step: 6, collection: 'planRows', fields: { indicatorIds: ['in3'] } })
    p = reducer(p, { type: 'item/add', step: 6, collection: 'planRows', fields: { mandatoryFigureIds: ['mf2'] } })
    expect(allCovered(p)).toBe(true)
    p = reducer(p, { type: 'item/add', step: 5, collection: 'indicators', fields: { focusQuestionId: 'fq2', text: 'Neu' } })
    expect(allCovered(p)).toBe(false)
  })
})

describe('a row’s references', () => {
  it('a deleted indicator, or one whose question went, is "Verweis fehlt"', () => {
    let p = project()
    p = reducer(p, { type: 'item/remove', step: 5, collection: 'focusQuestions', id: 'fq1' })
    const refs = planRefsOf(needs(p), p.steps[6].block.planRows[0])
    expect(refs.map((r) => [r.id, !!r.need])).toEqual([
      ['in1', false],
      ['in2', false],
    ])
  })

  it('is named by its first live reference, else its Datenquelle, else "ohne Bezug"', () => {
    const p = project()
    const all = needs(p)
    expect(rowName(all, p.steps[6].block.planRows[0])).toBe('„Öffnungstage mit beiden“')
    expect(rowName(all, row('x', { indicatorIds: ['gone'], dataSource: 'Fragebogen am Ende' }))).toBe('„Fragebogen am Ende“')
    expect(rowName(all, row('y', { dataSource: '' }))).toBe('ohne Bezug')
  })

  it('summary facts and the "Noch leer" fields in form order', () => {
    const r = row('x', { method: '', firstCollection: '', why: '' })
    expect(summaryFacts(r)).toEqual(['Teilnahmeliste', 'Teamleitung', 'jeden Monat'])
    expect(missingFields(r)).toEqual(['Methode und Instrument', 'Erster Termin', 'Warum?'])
  })
})

describe('⛔ rules', () => {
  it('a row without any reference and a missing Why block; rows are named by their first reference', () => {
    const p = project()
    p.steps[6].block.planRows.push(row('pr3', { why: '', dataSource: 'Gespräch' }))
    p.steps[6].block.planRows[0].why = ''
    expect(hardIssues(6, block6(p), ...issueContext(p)).map((i) => [i.criterion, i.text, i.target.field])).toEqual([
      ['10', 'Warum fehlt: Zeile 1 „Öffnungstage mit beiden“', 'why'],
      ['1', 'Planzeile ohne Bezug: Zeile 3 „Gespräch“', 'refs'],
      ['10', 'Warum fehlt: Zeile 3 „Gespräch“', 'why'],
    ])
  })

  it('only deleted references left is not a block (PO 2026-11-10) — it is the app’s ⚠ "Verweis fehlt"', () => {
    let p = project()
    p = reducer(p, { type: 'item/remove', step: 5, collection: 'mandatoryFigures', id: 'mf1' })
    expect(hardIssues(6, block6(p), ...issueContext(p))).toEqual([])
    const broken = appJudged(6, block6(p), p).find((j) => j.criterion === '1')!
    expect(broken).toMatchObject({ result: 'warn', note: 'Verweis fehlt: Zeile 2 „Teilnahmeliste“', target: { collection: 'planRows', id: 'pr2', field: 'refs' } })
  })

  it('confirming waits for the ⛔ and then goes through with the ⚠ stored', () => {
    let p = project()
    p = edit6(p, 'pr1', { why: '' })
    p.steps[6].qualityCheck = check(p) as never
    expect(confirmStep(p, 6, AT).steps[6].status).not.toBe('confirmed')
    p = edit6(p, 'pr1', { why: 'weil' })
    p.steps[6].qualityCheck = { ...check(p), results: withAppJudged(6, block6(p), check(p).results, p) } as never
    const done = confirmStep(p, 6, AT)
    expect(done.steps[6].status).toBe('confirmed')
    expect(done.steps[6].confirmedWarnings).toEqual(['2'])
  })
})

describe('the app’s own ⚠', () => {
  it('coverage names the first uncovered item with the count of both kinds; Zum Feld goes to "Planzeile anlegen"', () => {
    const j = appJudged(6, block6(project()), project()).find((x) => x.criterion === '2')!
    // One line per kind; Zum Feld to the first.
    expect(j).toMatchObject({ result: 'warn', note: 'Indikator ohne Planzeile: „Anteil, die selbst flicken“\nPflichtangabe ohne Planzeile: „Anzahl Termine“', target: { collection: 'coverage', id: 'in3', field: 'create' } })
    const p = project()
    p.steps[6].block.planRows.push(row('pr3', { indicatorIds: ['in3'] }))
    expect(appJudged(6, block6(p), p).find((x) => x.criterion === '2')!.note).toBe('Pflichtangabe ohne Planzeile: „Anzahl Termine“')
  })

  it('missing fields: one row per criterion, Zum Feld to the first empty field of the criterion', () => {
    let p = project()
    p = edit6(p, 'pr1', { collector: '', firstCollection: '' })
    p = edit6(p, 'pr2', { method: '', analysis: '' })
    const by = Object.fromEntries(appJudged(6, block6(p), p).map((j) => [j.criterion, j]))
    expect(by['3']).toMatchObject({ result: 'warn', note: 'Datenquelle oder Methode fehlt: Zeile 2 „Teilnehmende nach Geschlecht“', target: { id: 'pr2', field: 'method' } })
    expect(by['6']).toMatchObject({ result: 'warn', note: 'Wer, wann oder erster Termin fehlt: Zeile 1 „Öffnungstage mit beiden“', target: { id: 'pr1', field: 'collector' } })
    expect(by['9']).toMatchObject({ result: 'warn', note: 'Auswertung fehlt: Zeile 2 „Teilnehmende nach Geschlecht“', target: { id: 'pr2', field: 'analysis' } })
    expect(by['1'].result).toBe('ok')
  })

  it('the app owns 1, 2, 3, 6, 9 and 10; Claude judges 4, 5, 7 and 8, and its results for the app’s criteria are replaced', () => {
    expect(appOwned(6).sort()).toEqual(['1', '10', '2', '3', '6', '9'])
    const p = project()
    const results = withAppJudged(6, block6(p), check(p).results, p)
    expect(results.find((r) => r.criterion === '2')!.result).toBe('warn')
    expect(results.find((r) => r.criterion === '4')!.note).toBe('Claude')
  })
})

describe('closed rows (screen state)', () => {
  it('more than two rows start closed; the coverage list starts closed once everything is covered', () => {
    const p = project()
    expect(initialClosed(p)).toEqual([])
    p.steps[6].block.planRows.push(row('pr3', { indicatorIds: ['in3'] }), row('pr4', { mandatoryFigureIds: ['mf2'] }))
    expect(initialClosed(p)).toEqual(['pr1', 'pr2', 'pr3', 'pr4', COVERAGE_KEY])
  })

  it('a plan row is its own disclosure: its key is its id', () => {
    expect(panelGroupOf(project(), 6, 'pr2')).toBe('pr2')
    expect(panelGroupOf(project(), 6, 'in1')).toBeUndefined()
  })
})
