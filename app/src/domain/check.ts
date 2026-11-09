import type { LooseBlock } from './block'
import { leerFields } from './profile'
import type { Item } from './schemas/blocks'
import type { Project, QualityCheck } from './schemas/project'
import type { StepId } from './types'
import { treeOf } from './tree'

// Hard blocks (⛔) as code (tech design §7.2, PRD F4): exactly the PRD's three kinds — a
// missing Why, a step's number limits, mandatory links. Everything else is ⚠ and comes from
// the assistant's rubric judgement (report_quality_check). Steps 0 and 2–6 get theirs in
// steps 14–20.

/**
 * Where "Zum Feld" goes: a field of an item (by its `data-field`), or the add button of a list
 * without items. `step`: the fix lies in another step (the gate offers "Zu Schritt N" instead).
 */
export type FieldTarget = { collection: string; id?: string; field: string; step?: StepId; group?: string }

export type HardIssue = {
  /** The rubric criterion this rule belongs to (the step's rubric table in the guide). */
  criterion: string
  /** One line for the panel and the snapshot. */
  text: string
  target: FieldTarget
}

/** Which rubric criterion each kind of hard rule checks, per step (ids from the guide's rubric). */
export const HARD_CRITERIA: Partial<Record<StepId, { why: string; focus?: string }>> = {
  1: { why: '8', focus: '5' },
  2: { why: '9' },
}

/** A rubric criterion the app judges itself from the block (✓ or ⚠, never ⛔), overriding Claude. */
export type AppJudged = { criterion: string; result: 'ok' | 'warn'; note: string; target?: FieldTarget }

/** Step 0 criterion 1 "Vollständigkeit": every field filled or "offen" (design §6.2, step 14). */
export function appJudged(step: StepId, block: LooseBlock): AppJudged[] {
  if (step !== 0) return []
  const leer = leerFields(block)
  if (!leer.length) return [{ criterion: '1', result: 'ok', note: 'Jedes Feld ist ausgefüllt oder offen.' }]
  return [
    {
      criterion: '1',
      result: 'warn',
      note: `Noch leer, nicht als offen markiert: ${leer.map((f) => f.label).join(', ')}`,
      target: { collection: leer[0].form, id: leer[0].form, field: leer[0].field },
    },
  ]
}

/** Criteria Claude may leave out because the app owns them (hard rules and app-judged ones). */
export function appOwned(step: StepId): string[] {
  const appIds: Partial<Record<StepId, string[]>> = { 0: ['1'] }
  return [...Object.values(HARD_CRITERIA[step] ?? {}), ...(appIds[step] ?? [])]
}

/** Claude's results with the app-judged criteria replaced by the app's own judgement of `block`. */
export function withAppJudged(step: StepId, block: LooseBlock, results: QualityCheck['results']): QualityCheck['results'] {
  const own = new Map(appJudged(step, block).map((j) => [j.criterion, { criterion: j.criterion, result: j.result, note: j.note }]))
  return results.map((r) => own.get(r.criterion) ?? r)
}

const empty = (text: string | undefined) => !text?.trim()
const groupName = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'
/** Item text in a check row: cut at `n` characters. */
export const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()} …` : text)

/**
 * The ⛔ issues of a step's block, in panel order. `groups` = step 1's target groups now
 * (steps 2–4 are judged per focus group).
 */
export function hardIssues(step: StepId, block: LooseBlock, groups: Item[] = []): HardIssue[] {
  if (step === 2) return step2Issues(block, groups)
  if (step !== 1) return []
  const ids = HARD_CRITERIA[1]!
  const issues: HardIssue[] = []
  const challenge = block.challenge as Item
  if (empty(challenge.why)) issues.push({ criterion: ids.why, text: 'Warum fehlt: Herausforderung', target: { collection: 'challenge', id: challenge.id, field: 'why' } })
  const own = block.targetGroups as Item[]
  for (const g of own) {
    if (empty(g.why)) issues.push({ criterion: ids.why, text: `Warum fehlt: Zielgruppe „${groupName(g)}“`, target: { collection: 'targetGroups', id: g.id, field: 'why' } })
  }
  const focus = own.filter((g) => g.isFocus)
  if (!focus.length) {
    issues.push({
      criterion: ids.focus!,
      text: 'Noch keine Fokusgruppe gewählt (1 oder 2)',
      target: own.length ? { collection: 'targetGroups', id: own[0].id, field: 'isFocus' } : { collection: 'targetGroups', field: 'add' },
    })
  } else if (focus.length > 2) {
    issues.push({
      criterion: ids.focus!,
      text: `${focus.length} Fokusgruppen gewählt – höchstens 2`,
      target: { collection: 'targetGroups', id: focus[2].id, field: 'isFocus' },
    })
  }
  return issues
}

/** Step 2, criterion 9 (design §6.2 "Step 16"): core problems and causes need a Why; each focus group a core problem. */
function step2Issues(block: LooseBlock, groups: Item[]): HardIssue[] {
  const why = HARD_CRITERIA[2]!.why
  const problems = (block.problems as Item[]) ?? []
  const causes = (block.causes as Item[]) ?? []
  const toStep1 = { collection: 'targetGroups', field: 'isFocus', step: 1 as StepId }
  const focus = groups.filter((g) => g.isFocus)
  const issues: HardIssue[] = []
  if (!focus.length) issues.push({ criterion: why, text: 'Wähle in Schritt 1 eine oder zwei Fokusgruppen', target: toStep1 })
  if (focus.length > 2) issues.push({ criterion: why, text: `${focus.length} Fokusgruppen in Schritt 1 – höchstens 2`, target: toStep1 })
  for (const g of [...focus, ...groups.filter((g) => !g.isFocus)]) {
    const name = groupName(g)
    const problem = problems.find((p) => p.groupId === g.id)
    const text = (problem?.coreProblem as string | undefined) ?? ''
    if (g.isFocus && empty(text)) {
      issues.push({ criterion: why, text: `Kernproblem fehlt · ${name}`, target: { collection: 'problems', id: problem?.id ?? `problem:${g.id}`, field: 'coreProblem', group: g.id } })
    } else if (problem && !empty(text) && empty(problem.why)) {
      issues.push({ criterion: why, text: `Warum fehlt: Kernproblem · ${name}`, target: { collection: 'problems', id: problem.id, field: 'why', group: g.id } })
    }
    if (!g.isFocus) continue
    const rows = (list: ReturnType<typeof treeOf>): Item[] => list.flatMap((r) => [r.item, ...rows(r.children)])
    for (const c of rows(treeOf(causes.filter((c) => c.groupId === g.id)))) {
      if (!empty(c.why)) continue
      const label = (c.text as string) ? `„${cut(c.text as string, 50)}“` : 'ohne Text'
      issues.push({ criterion: why, text: `Warum fehlt: Ursache ${label} · ${name}`, target: { collection: 'causes', id: c.id, field: 'why', group: g.id } })
    }
  }
  return issues
}

/** One key per field, shared by the gate's rows and the block's ⛔ field markers. */
export const fieldKey = (collection: string, id: string | undefined, field: FieldTarget['field']) => `${collection}:${id ?? ''}:${field}`
export const issueKey = (issue: HardIssue) => fieldKey(issue.target.collection, issue.target.id, issue.target.field)

/** Step 1's target groups as hardIssues needs them. */
export const groupsOf = (project: Project): Item[] => project.steps[1].block.targetGroups as Item[]

/** JSON with sorted keys, so two blocks compare by content, not by key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  // Like JSON: a key holding undefined counts as missing.
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export const sameBlock = (a: unknown, b: unknown) => stable(a) === stable(b)

/** The check still describes the block as it is now (no edit or applied change since). */
export function checkCurrent(project: Project, step: StepId): boolean {
  const state = project.steps[step]
  return !!state.qualityCheck && sameBlock(state.qualityCheck.block, state.block)
}

/** Criteria the assistant marked ⚠ and no hard rule blocks: what confirming stores as "trotzdem bestätigt". */
export function openWarnings(step: StepId, check: QualityCheck, groups: Item[] = []): string[] {
  const blocked = new Set(hardIssues(step, check.block as LooseBlock, groups).map((i) => i.criterion))
  return check.results.filter((r) => r.result === 'warn' && !blocked.has(r.criterion)).map((r) => r.criterion)
}

/**
 * Confirming (PRD F4): only with a check of the current block and no ⛔ left. Stores the
 * snapshot, the earlier steps' confirm times it builds on (F6) and the ⚠ points confirmed
 * anyway. The cascade to later steps on a re-confirm follows in step 21.
 */
export function confirmStep(project: Project, step: StepId, at: string): Project {
  const state = project.steps[step]
  if (!state.qualityCheck || !checkCurrent(project, step) || hardIssues(step, state.block as LooseBlock, groupsOf(project)).length) return project
  const next = structuredClone(project)
  const s = next.steps[step]
  const basis: Partial<Record<StepId, string>> = {}
  for (let earlier = 0; earlier < step; earlier++) {
    const confirmedAt = next.steps[earlier as StepId].confirmed?.at
    if (confirmedAt) basis[earlier as StepId] = confirmedAt
  }
  s.status = 'confirmed'
  s.confirmedWarnings = openWarnings(step, state.qualityCheck, groupsOf(project))
  s.confirmed = { at, block: structuredClone(s.block) as never, basis }
  return next
}
