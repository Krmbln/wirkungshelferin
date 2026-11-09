import { rubricCriteria } from '../../ai/tools'
import type { LooseBlock } from '../../domain/block'
import { appJudged, checkCurrent, hardIssues, issueContext, issueKey, sameBlock, type FieldTarget, type HardIssue } from '../../domain/check'
import type { Project, QualityCheck } from '../../domain/schemas/project'
import type { StepId } from '../../domain/types'

// What the quality gate shows (design §6.2, three-state gate), derived from the stored project.
// Pure, so the state machine is tested without the UI.

export type BlockRow = { key: string; text: string; target: FieldTarget }
/** `target`: an app-judged ⚠ row's "Zum Feld" (step 0 completeness). */
export type JudgedRow = { criterion: string; name: string; note: string; result: 'ok' | 'warn'; confirmedAnyway: boolean; target?: FieldTarget }

export type GateView = {
  /**
   * unchecked = A without a result; changed = A, the block changed since the check (old result
   * greyed); blocked = B; ready = C; confirmed = confirmed and unchanged since.
   */
  kind: 'unchecked' | 'changed' | 'blocked' | 'ready' | 'confirmed'
  /** ⛔ rows. When changed: only those the check found that are still open now. */
  blocking: BlockRow[]
  warn: JudgedRow[]
  ok: JudgedRow[]
  check?: QualityCheck
  confirmedAt?: string
}

const toRow = (issue: HardIssue): BlockRow => ({ key: issueKey(issue), text: issue.text, target: issue.target })

/**
 * The ⛔ issues on screen (rows and field markers): those the last check found that still hold.
 * `live` (a check runs or just failed): every issue of the block now — code knows them at once,
 * also offline (design §6.2 "code ⛔ rules instantly").
 */
export function stillOpen(project: Project, step: StepId, live = false): HardIssue[] {
  const state = project.steps[step]
  const ctx = issueContext(project)
  if (live && !checkCurrent(project, step)) return hardIssues(step, state.block as LooseBlock, ...ctx)
  if (!state.qualityCheck) return []
  const found = new Set(hardIssues(step, state.qualityCheck.block as LooseBlock, ...ctx).map(issueKey))
  return hardIssues(step, state.block as LooseBlock, ...ctx).filter((i) => found.has(issueKey(i)))
}

/**
 * ✓/⚠ rows in rubric order; a criterion a hard rule blocks shows only its ⛔ rows. App-judged
 * criteria follow the block as it is now, so their row updates while Lukas fills fields.
 */
function judged(step: StepId, check: QualityCheck, project: Project, confirmedWarnings: string[]): Pick<GateView, 'warn' | 'ok'> {
  const names = new Map(rubricCriteria(step).map((c) => [c.id, c.name]))
  const blocked = new Set(hardIssues(step, check.block as LooseBlock, ...issueContext(project)).map((i) => i.criterion))
  const live = new Map(appJudged(step, project.steps[step].block as LooseBlock, project).map((j) => [j.criterion, j]))
  const rows = check.results
    .filter((r) => !blocked.has(r.criterion))
    .map((r) => ({ ...r, ...live.get(r.criterion) }))
    .map((r) => ({ ...r, name: names.get(r.criterion) ?? `Kriterium ${r.criterion}`, confirmedAnyway: r.result === 'warn' && confirmedWarnings.includes(r.criterion) }))
  return { warn: rows.filter((r) => r.result === 'warn'), ok: rows.filter((r) => r.result === 'ok') }
}

/** `live`: a check runs or failed, so the ⛔ rows come from the block as it is now. */
export function gateView(project: Project, step: StepId, live = false): GateView {
  const state = project.steps[step]
  const check = state.qualityCheck
  const current = checkCurrent(project, step)
  const rows = check ? judged(step, check, project, state.status === 'confirmed' ? state.confirmedWarnings : []) : { warn: [], ok: [] }
  if (state.status === 'confirmed' && state.confirmed && sameBlock(state.confirmed.block, state.block)) {
    return { kind: 'confirmed', blocking: [], ...(current ? rows : { warn: [], ok: [] }), check: current ? check : undefined, confirmedAt: state.confirmed.at }
  }
  if (!check) return { kind: 'unchecked', blocking: stillOpen(project, step, live).map(toRow), warn: [], ok: [] }
  if (!current) return { kind: 'changed', blocking: stillOpen(project, step, live).map(toRow), ...rows, check }
  const blocking = hardIssues(step, check.block as LooseBlock, ...issueContext(project)).map(toRow)
  return { kind: blocking.length ? 'blocked' : 'ready', blocking, ...rows, check }
}

/** The element "Zum Feld" focuses, inside the block panel. */
export function fieldSelector(target: FieldTarget): string {
  // Step 3: "+ Ziel" of one group (and level) is "goals-tg1-5" / "goals-tg3".
  if (target.field === 'add' && target.id) return `[data-add="${CSS.escape(`${target.collection}-${target.id}`)}"]`
  if (target.field === 'add' || !target.id) return `[data-add="${CSS.escape(target.collection)}"]`
  const item = `[data-item-id="${CSS.escape(target.id)}"]`
  if (target.field === 'isFocus') return `${item} [data-field="isFocus"]`
  const field = `${item} [data-field="${CSS.escape(target.field)}"]`
  // Step 3: a goal's links have no text input; "Ursache wählen" is the field.
  if (target.field === 'causeIds') return `${field} button`
  return `${field} textarea, ${field} input`
}

export const blockingText = (n: number) => (n === 1 ? 'Noch 1 Punkt blockiert das Bestätigen' : `Noch ${n} Punkte blockieren das Bestätigen`)
export const okText = (n: number) => (n === 1 ? '1 Punkt erfüllt' : `${n} Punkte erfüllt`)
export const warnConfirmText = (n: number) =>
  n === 1 ? '1 offener Punkt wird mit gespeichert. Trotzdem bestätigen?' : `${n} offene Punkte werden mit gespeichert. Trotzdem bestätigen?`
