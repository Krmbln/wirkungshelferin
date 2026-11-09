import type { LooseBlock } from './block'
import { leerFields } from './profile'
import type { Item } from './schemas/blocks'
import type { Project, QualityCheck } from './schemas/project'
import type { StepId } from './types'
import { GOAL_LEVELS, treeOf } from './tree'

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
export const HARD_CRITERIA: Partial<Record<StepId, { why: string; focus?: string; levels?: string; link?: string; level7?: string; nonFocus?: string }>> = {
  1: { why: '8', focus: '5' },
  2: { why: '9' },
  3: { why: '10', levels: '4', link: '5', level7: '8', nonFocus: '9' },
}

/**
 * Criteria the app blocks on, but Claude still judges what isn't a hard rule (step 3, 8: a
 * missing Stufe 7 is ⛔, "bewirkt" instead of "trägt dazu bei" is Claude's ⚠).
 */
const SHARED: Partial<Record<StepId, string[]>> = { 3: ['8'] }

/** A rubric criterion the app judges itself from the block (✓ or ⚠, never ⛔), overriding Claude. */
export type AppJudged = { criterion: string; result: 'ok' | 'warn'; note: string; target?: FieldTarget }

/**
 * Step 0 criterion 1 "Vollständigkeit": every field filled or "offen" (design §6.2, step 14).
 * Step 3 criterion 5: a link whose step 2 item was deleted since is ⚠ "Verweis fehlt" (guide 00
 * §9); a link never set is ⛔ (hardIssues). Needs `project` for step 2's items.
 */
export function appJudged(step: StepId, block: LooseBlock, project?: Project): AppJudged[] {
  if (step === 3) return project ? step3Judged(block, project) : []
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

/**
 * Step 3: criterion 5 ⚠ for a focus goal whose cause was deleted in step 2 since (a non-focus
 * goal's link is derived from its group), criterion 6 ⚠ for a goal without time frame.
 */
function step3Judged(block: LooseBlock, project: Project): AppJudged[] {
  const groups = groupsOf(project)
  const causes = new Set(project.steps[2].block.causes.map((c) => c.id))
  const goals = ((block.goals as Item[]) ?? []).filter((g) => groups.some((t) => t.id === g.groupId) && !empty(g.text as string))
  const name = (g: Item) => groupName(groups.find((t) => t.id === g.groupId)!)
  const label = (g: Item) => `„${cut(g.text as string, 50)}“`
  const more = (n: number) => (n > 1 ? ` (und ${n - 1} weitere)` : '')
  const target = (g: Item, field: string): FieldTarget => ({ collection: 'goals', id: g.id, field, group: g.groupId as string })
  const broken = goals.filter((g) => groups.find((t) => t.id === g.groupId)?.isFocus && (g.causeIds as string[]).some((id) => !causes.has(id)))
  const undated = goals.filter((g) => empty(g.timeFrame as string))
  return [
    broken.length
      ? { criterion: '5', result: 'warn', note: `Verweis fehlt: Ziel ${label(broken[0])} · ${name(broken[0])}${more(broken.length)}`, target: target(broken[0], 'causeIds') }
      : { criterion: '5', result: 'ok', note: 'Jedes Ziel ist mit einer Ursache bzw. dem Kernproblem verknüpft.' },
    undated.length
      ? { criterion: '6', result: 'warn', note: `Zeitrahmen fehlt: Ziel ${label(undated[0])} · ${name(undated[0])}${more(undated.length)}`, target: target(undated[0], 'timeFrame') }
      : { criterion: '6', result: 'ok', note: 'Jedes Ziel hat einen Zeitrahmen.' },
  ]
}

/** Criteria Claude may leave out because the app owns them (hard rules and app-judged ones). */
export function appOwned(step: StepId): string[] {
  const appIds: Partial<Record<StepId, string[]>> = { 0: ['1'], 3: ['5', '6'] }
  const shared = SHARED[step] ?? []
  return [...new Set([...Object.values(HARD_CRITERIA[step] ?? {}), ...(appIds[step] ?? [])])].filter((id) => !shared.includes(id))
}

/** Claude's results with the app-judged criteria replaced by the app's own judgement of `block`. */
export function withAppJudged(step: StepId, block: LooseBlock, results: QualityCheck['results'], project?: Project): QualityCheck['results'] {
  const own = new Map(appJudged(step, block, project).map((j) => [j.criterion, { criterion: j.criterion, result: j.result, note: j.note }]))
  return results.map((r) => own.get(r.criterion) ?? r)
}

const empty = (text: string | undefined) => !text?.trim()
const groupName = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'
/** Item text in a check row: cut at `n` characters, at the last word boundary when one is near (design check step 17). */
export function cut(text: string, n: number): string {
  if (text.length <= n) return text
  const head = text.slice(0, n - 1)
  const space = head.lastIndexOf(' ')
  return `${(space > n / 2 ? head.slice(0, space) : head).trimEnd()} …`
}

/**
 * The ⛔ issues of a step's block, in panel order. `groups` = step 1's target groups now
 * (steps 2–4 are judged per focus group), `problems` = step 2's core problems now (step 3:
 * a non-focus group's goals link to its core problem). Callers pass both via `issueContext`.
 */
export function hardIssues(step: StepId, block: LooseBlock, groups: Item[] = [], problems: Item[] = []): HardIssue[] {
  if (step === 2) return step2Issues(block, groups)
  if (step === 3) return step3Issues(block, groups, problems)
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

/** Step 3 (design §6.2 "Step 17"): criteria 4, 5, 8, 9 and 10 as code; every row names its group. */
function step3Issues(block: LooseBlock, groups: Item[], problems: Item[]): HardIssue[] {
  const ids = HARD_CRITERIA[3]!
  const goals = (block.goals as Item[]) ?? []
  const marks = (block.levelNotApplicable as Item[]) ?? []
  const level7 = block.level7 as Item
  const toStep1 = { collection: 'targetGroups', field: 'isFocus', step: 1 as StepId }
  const focus = groups.filter((g) => g.isFocus)
  const issues: HardIssue[] = []
  if (!focus.length) issues.push({ criterion: ids.levels!, text: 'Wähle in Schritt 1 eine oder zwei Fokusgruppen', target: toStep1 })
  if (focus.length > 2) issues.push({ criterion: ids.levels!, text: `${focus.length} Fokusgruppen in Schritt 1 – höchstens 2`, target: toStep1 })
  const goalLabel = (g: Item) => ((g.text as string) ? `„${cut(g.text as string, 50)}“` : 'ohne Text')
  const goalIssues = (g: Item, name: string, focusGroup: boolean) => {
    // A non-focus goal's link is its group's core problem (derived, design "Step 17").
    if (focusGroup && !(g.causeIds as string[]).length)
      issues.push({ criterion: ids.link!, text: `Ziel ohne Ursache: ${goalLabel(g)} · ${name}`, target: { collection: 'goals', id: g.id, field: 'causeIds', group: g.groupId as string } })
    if (empty(g.why)) issues.push({ criterion: ids.why, text: `Warum fehlt: Ziel ${goalLabel(g)} · ${name}`, target: { collection: 'goals', id: g.id, field: 'why', group: g.groupId as string } })
  }
  for (const group of focus) {
    const name = groupName(group)
    for (const level of GOAL_LEVELS) {
      // A goal without text counts as missing, like an empty core problem (step 2).
      const all = goals.filter((g) => g.groupId === group.id && g.level === level)
      const here = all.filter((g) => !empty(g.text as string))
      const mark = marks.find((m) => m.groupId === group.id && m.level === level)
      if (!here.length && !mark) {
        // A row without text already there: Zum Feld goes to it, not to "+ Ziel".
        const target: FieldTarget = all.length
          ? { collection: 'goals', id: all[0].id, field: 'text', group: group.id }
          : { collection: 'goals', id: `${group.id}-${level}`, field: 'add', group: group.id }
        issues.push({ criterion: ids.levels!, text: `Stufe ${level} ist leer · ${name}`, target })
      }
      if (mark && empty(mark.why)) {
        issues.push({ criterion: ids.why, text: `Warum fehlt: Stufe ${level} trifft nicht zu · ${name}`, target: { collection: 'levelNotApplicable', id: mark.id, field: 'why', group: group.id } })
      }
      for (const g of here) goalIssues(g, name, true)
    }
  }
  for (const group of groups.filter((g) => !g.isFocus)) {
    const name = groupName(group)
    const all = goals.filter((g) => g.groupId === group.id)
    const own = all.filter((g) => !empty(g.text as string))
    if (!own.length) {
      const target: FieldTarget = all.length ? { collection: 'goals', id: all[0].id, field: 'text', group: group.id } : { collection: 'goals', id: group.id, field: 'add', group: group.id }
      issues.push({ criterion: ids.nonFocus!, text: `Kein Ziel · ${name}`, target })
    }
    const problem = problems.find((p) => p.groupId === group.id)
    if (own.length && empty(problem?.coreProblem as string | undefined)) {
      issues.push({ criterion: ids.link!, text: `Kein Kernproblem in Schritt 2 · ${name}`, target: { collection: 'problems', id: problem?.id ?? `problem:${group.id}`, field: 'coreProblem', step: 2, group: group.id } })
    }
    for (const g of own) goalIssues(g, name, false)
  }
  if (empty(level7.text as string)) issues.push({ criterion: ids.level7!, text: 'Stufe 7 fehlt', target: { collection: 'level7', id: level7.id, field: 'text' } })
  else if (empty(level7.why)) issues.push({ criterion: ids.why, text: 'Warum fehlt: Stufe 7', target: { collection: 'level7', id: level7.id, field: 'why' } })
  return issues
}

/** One key per field, shared by the gate's rows and the block's ⛔ field markers. */
export const fieldKey = (collection: string, id: string | undefined, field: FieldTarget['field']) => `${collection}:${id ?? ''}:${field}`
export const issueKey = (issue: HardIssue) => fieldKey(issue.target.collection, issue.target.id, issue.target.field)

/** Step 1's target groups as hardIssues needs them. */
export const groupsOf = (project: Project): Item[] => project.steps[1].block.targetGroups as Item[]

/** What hardIssues and openWarnings need besides the block: `hardIssues(step, block, ...issueContext(project))`. */
export const issueContext = (project: Project): [Item[], Item[]] => [groupsOf(project), project.steps[2].block.problems as Item[]]

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
export function openWarnings(step: StepId, check: QualityCheck, groups: Item[] = [], problems: Item[] = []): string[] {
  const blocked = new Set(hardIssues(step, check.block as LooseBlock, groups, problems).map((i) => i.criterion))
  return check.results.filter((r) => r.result === 'warn' && !blocked.has(r.criterion)).map((r) => r.criterion)
}

/**
 * Confirming (PRD F4): only with a check of the current block and no ⛔ left. Stores the
 * snapshot, the earlier steps' confirm times it builds on (F6) and the ⚠ points confirmed
 * anyway. The cascade to later steps on a re-confirm follows in step 21.
 */
export function confirmStep(project: Project, step: StepId, at: string): Project {
  const state = project.steps[step]
  if (!state.qualityCheck || !checkCurrent(project, step) || hardIssues(step, state.block as LooseBlock, ...issueContext(project)).length) return project
  const next = structuredClone(project)
  const s = next.steps[step]
  const basis: Partial<Record<StepId, string>> = {}
  for (let earlier = 0; earlier < step; earlier++) {
    const confirmedAt = next.steps[earlier as StepId].confirmed?.at
    if (confirmedAt) basis[earlier as StepId] = confirmedAt
  }
  s.status = 'confirmed'
  s.confirmedWarnings = openWarnings(step, state.qualityCheck, ...issueContext(project))
  s.confirmed = { at, block: structuredClone(s.block) as never, basis }
  return next
}
