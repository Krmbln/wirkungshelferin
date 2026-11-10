import type { LooseBlock } from './block'
import { cut } from './check'
import { indicatorsOf, questionsOf } from './focus'
import type { Item } from './schemas/blocks'
import type { Project } from './schemas/project'

// Step 6 (design §6.2 "Step 20"): the data collection plan. Every plan row belongs to step 5
// indicators and/or mandatory figures; what still needs a row is derived (never copied). Pure
// helpers shared by the check, the tool rules, the panel and the card wording.

/** The seven fields of a plan row in form order (guide §1), with the labels the check rows use. */
export const PLAN_FIELDS = [
  { field: 'dataSource', label: 'Datenquelle' },
  { field: 'method', label: 'Methode und Instrument' },
  { field: 'collector', label: 'Wer erhebt?' },
  { field: 'frequency', label: 'Wann und wie oft?' },
  { field: 'firstCollection', label: 'Erster Termin' },
  { field: 'consentNote', label: 'Einwilligung und Datenschutz' },
  { field: 'analysis', label: 'Auswertung und Nutzung' },
] as const

export type PlanField = (typeof PLAN_FIELDS)[number]['field']

const list = (block: LooseBlock, name: string) => (block[name] as Item[] | undefined) ?? []
const step5 = (project: Project) => project.steps[5].block as unknown as LooseBlock
export const planRowsOf = (project: Project) => list(project.steps[6].block as unknown as LooseBlock, 'planRows')
const blank = (text: unknown) => !(text as string | undefined)?.trim()

/** Something in step 5 that needs a plan row: an indicator (with its question) or a mandatory figure. */
export type Need = { kind: 'indicator'; item: Item; question: Item; questionNo: number } | { kind: 'figure'; item: Item }

/** Indicators by question (question order, then indicator order), then mandatory figures. Orphan indicators are left out (step 5's ⛔). */
export const needs = (project: Project): Need[] => needsOf(step5(project))

export function needsOf(block: LooseBlock): Need[] {
  return [
    ...questionsOf(block).flatMap((question, n) => indicatorsOf(block, question.id).map((item): Need => ({ kind: 'indicator', item, question, questionNo: n + 1 }))),
    ...list(block, 'mandatoryFigures').map((item): Need => ({ kind: 'figure', item })),
  ]
}

const refIds = (row: Item, kind: Need['kind']) => (row[kind === 'indicator' ? 'indicatorIds' : 'mandatoryFigureIds'] as string[] | undefined) ?? []

/** The rows (1-based, in list order) that cover a step 5 item. */
export function rowsCovering(rows: Item[], kind: Need['kind'], id: string): number[] {
  return rows.flatMap((row, n) => (refIds(row, kind).includes(id) ? [n + 1] : []))
}

export type Coverage = { need: Need; rows: number[] }

export function coverage(project: Project, rows = planRowsOf(project)): Coverage[] {
  return needs(project).map((need) => ({ need, rows: rowsCovering(rows, need.kind, need.item.id) }))
}

export const allCovered = (project: Project, rows = planRowsOf(project)) => coverage(project, rows).every((c) => c.rows.length > 0)

/** A row's reference as the panel shows it; `need` missing = deleted (an indicator whose question went counts as deleted). */
export type PlanRef = { kind: Need['kind']; id: string; need?: Need }

export function planRefsOf(all: Need[], row: Item): PlanRef[] {
  const find = (kind: Need['kind'], id: string): PlanRef => ({ kind, id, need: all.find((n) => n.kind === kind && n.item.id === id) })
  return [...refIds(row, 'indicator').map((id) => find('indicator', id)), ...refIds(row, 'figure').map((id) => find('figure', id))]
}

/** A row has a reference set at all (⛔ criterion 1 when not; a deleted one is ⚠). */
export const hasRefs = (row: Item) => refIds(row, 'indicator').length + refIds(row, 'figure').length > 0

/** The text of what a reference points to: an indicator's text, a figure's name. */
export const needText = (need: Need) => ((need.kind === 'indicator' ? need.item.text : need.item.name) as string) ?? ''

/**
 * A row named in check rows, the ✕ and cards (design "Step 20"), `all` = needs(project): its
 * first live reference „…“ cut at `n`; without one its Datenquelle; else "ohne Bezug" (no quotes).
 */
export function rowName(all: Need[], row: Item, n = 40): string {
  const first = planRefsOf(all, row).find((r) => r.need)
  if (first) {
    const text = needText(first.need!)
    return text.trim() ? `„${cut(text, n)}“` : first.kind === 'indicator' ? 'Indikator ohne Text' : 'Pflichtangabe ohne Namen'
  }
  const source = row.dataSource as string
  return source?.trim() ? `„${cut(source, n)}“` : 'ohne Bezug'
}

/** The empty fields of a row in form order, "Warum?" last (the closed row's "Noch leer" line). */
export function missingFields(row: Item): string[] {
  return [...PLAN_FIELDS.filter((f) => blank(row[f.field])).map((f) => f.label), ...(blank(row.why) ? ['Warum?'] : [])]
}

export const isBlankField = (row: Item, field: string) => blank(row[field])

/** The closed row's summary: Datenquelle · Methode (cut at 40) · Wer erhebt · Wann und wie oft (at 30), empty ones skipped. */
export function summaryFacts(row: Item): string[] {
  return (['dataSource', 'method', 'collector', 'frequency'] as const).flatMap((f) => (blank(row[f]) ? [] : [cut((row[f] as string).trim(), f === 'dataSource' || f === 'method' ? 40 : 30)]))
}

/** Key of the coverage section in the collapsed list (row keys are row ids). */
export const COVERAGE_KEY = 'coverage'

/**
 * Closed keys when step 6 first shows in a session (design "Step 20"): more than two rows start
 * closed; the coverage list starts closed once everything is covered.
 */
export function initialClosed(project: Project): string[] {
  const rows = planRowsOf(project)
  return [...(rows.length > 2 ? rows.map((r) => r.id) : []), ...(needs(project).length && allCovered(project, rows) ? [COVERAGE_KEY] : [])]
}

/** A row that more than two applied changes touch stays as it is (design "Step 20": a bulk Übernehmen opens nothing). */
export const BULK_OPEN_MAX = 2
