import type { LooseBlock } from './block'
import type { Item } from './schemas/blocks'
import type { Project, QualityCheck } from './schemas/project'
import type { StepId } from './types'

// Hard blocks (⛔) as code (tech design §7.2, PRD F4): exactly the PRD's three kinds — a
// missing Why, a step's number limits, mandatory links. Everything else is ⚠ and comes from
// the assistant's rubric judgement (report_quality_check). Steps 0 and 2–6 get theirs in
// steps 14–20.

/** Where "Zum Feld" goes: a field of an item, or the add button of a list without items. */
export type FieldTarget = { collection: string; id?: string; field: 'why' | 'isFocus' | 'add' }

export type HardIssue = {
  /** The rubric criterion this rule belongs to (the step's rubric table in the guide). */
  criterion: string
  /** One line for the panel and the snapshot. */
  text: string
  target: FieldTarget
}

/** Which rubric criterion each kind of hard rule checks, per step (ids from the guide's rubric). */
export const HARD_CRITERIA: Partial<Record<StepId, { why: string; focus: string }>> = {
  1: { why: '8', focus: '5' },
}

const empty = (text: string | undefined) => !text?.trim()
const groupName = (g: Item) => (g.name as string) || 'Zielgruppe ohne Namen'

/** The ⛔ issues of a step's block, in panel order. */
export function hardIssues(step: StepId, block: LooseBlock): HardIssue[] {
  if (step !== 1) return []
  const ids = HARD_CRITERIA[1]!
  const issues: HardIssue[] = []
  const challenge = block.challenge as Item
  if (empty(challenge.why)) issues.push({ criterion: ids.why, text: 'Warum fehlt: Herausforderung', target: { collection: 'challenge', id: challenge.id, field: 'why' } })
  const groups = block.targetGroups as Item[]
  for (const g of groups) {
    if (empty(g.why)) issues.push({ criterion: ids.why, text: `Warum fehlt: Zielgruppe „${groupName(g)}“`, target: { collection: 'targetGroups', id: g.id, field: 'why' } })
  }
  const focus = groups.filter((g) => g.isFocus)
  if (!focus.length) {
    issues.push({
      criterion: ids.focus,
      text: 'Noch keine Fokusgruppe gewählt (1 oder 2)',
      target: groups.length ? { collection: 'targetGroups', id: groups[0].id, field: 'isFocus' } : { collection: 'targetGroups', field: 'add' },
    })
  } else if (focus.length > 2) {
    issues.push({
      criterion: ids.focus,
      text: `${focus.length} Fokusgruppen gewählt – höchstens 2`,
      target: { collection: 'targetGroups', id: focus[2].id, field: 'isFocus' },
    })
  }
  return issues
}

/** One key per field, shared by the gate's rows and the block's ⛔ field markers. */
export const fieldKey = (collection: string, id: string | undefined, field: FieldTarget['field']) => `${collection}:${id ?? ''}:${field}`
export const issueKey = (issue: HardIssue) => fieldKey(issue.target.collection, issue.target.id, issue.target.field)

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
export function openWarnings(step: StepId, check: QualityCheck): string[] {
  const blocked = new Set(hardIssues(step, check.block as LooseBlock).map((i) => i.criterion))
  return check.results.filter((r) => r.result === 'warn' && !blocked.has(r.criterion)).map((r) => r.criterion)
}

/**
 * Confirming (PRD F4): only with a check of the current block and no ⛔ left. Stores the
 * snapshot, the earlier steps' confirm times it builds on (F6) and the ⚠ points confirmed
 * anyway. The cascade to later steps on a re-confirm follows in step 21.
 */
export function confirmStep(project: Project, step: StepId, at: string): Project {
  const state = project.steps[step]
  if (!state.qualityCheck || !checkCurrent(project, step) || hardIssues(step, state.block as LooseBlock).length) return project
  const next = structuredClone(project)
  const s = next.steps[step]
  const basis: Partial<Record<StepId, string>> = {}
  for (let earlier = 0; earlier < step; earlier++) {
    const confirmedAt = next.steps[earlier as StepId].confirmed?.at
    if (confirmedAt) basis[earlier as StepId] = confirmedAt
  }
  s.status = 'confirmed'
  s.confirmedWarnings = openWarnings(step, state.qualityCheck)
  s.confirmed = { at, block: structuredClone(s.block) as never, basis }
  return next
}
