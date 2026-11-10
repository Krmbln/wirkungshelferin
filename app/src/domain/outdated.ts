import { isConfirmed } from './block'
import { sameBlock } from './check'
import type { Project } from './schemas/project'
import { stepIds, type StepId } from './types'

// Change handling (PRD F6, tech design §9, design "Step 21"): a re-confirm with changed content
// marks the later confirmed steps "vielleicht veraltet". Pure functions; confirmStep calls the cascade.

type Snapshot = { at: string; block: Record<string, unknown> }

/**
 * An item or a list of items without bookkeeping: `rev` and "von dir geändert" aren't content.
 * Top level of each item only: no block nests items today.
 */
function content(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(content)
  if (!value || typeof value !== 'object') return value
  const { rev: _rev, editedByUser: _edited, ...rest } = value as Record<string, unknown>
  return rest
}

const changed = (before: Record<string, unknown>, after: Record<string, unknown>, part: string) => !sameBlock(content(before[part]), content(after[part]))

const later = (from: number) => stepIds.filter((s) => s >= from)

/**
 * The later steps a re-confirm reaches, by what changed against the last confirmed version.
 * Step 0: the profile → 1–6, only the measurement frame → 5–6, only sources → none.
 */
export function reachedBy(step: StepId, before: Record<string, unknown>, after: Record<string, unknown>): StepId[] {
  if (step === 0) {
    if (changed(before, after, 'profile')) return later(1)
    return changed(before, after, 'frame') ? later(5) : []
  }
  return Object.keys(after).some((part) => changed(before, after, part)) ? later(step + 1) : []
}

/**
 * Marks what a re-confirm of `step` reaches, on a project being built (mutates `next`). Only steps
 * that are confirmed or already outdated; each keeps the oldest version it was built on. Measured
 * against that version, a change undone (A → B → A) or a profile change reverted (step 0) no
 * longer reaches the step: its mark goes, and without marks it is confirmed again (or in Arbeit
 * if Lukas edited it meanwhile).
 */
export function markOutdated(next: Project, step: StepId, previous: Snapshot): void {
  const now = next.steps[step].confirmed!.block as Record<string, unknown>
  for (const s of reachedBy(step, previous.block, now)) {
    const state = next.steps[s]
    if (!isConfirmed(state.status)) continue
    const by: NonNullable<Project['steps'][StepId]['outdatedBy']> = { ...state.outdatedBy }
    const then = by[step] ?? structuredClone(previous)
    if (reachedBy(step, then.block, now).includes(s)) by[step] = then
    else delete by[step]
    if (Object.keys(by).length) {
      state.outdatedBy = by
      state.status = 'maybe_outdated'
    } else {
      delete state.outdatedBy
      state.status = settled({ ...state, status: 'confirmed' }) ? 'confirmed' : 'in_progress'
    }
  }
}

/** A confirmed version stands and the block is still exactly it (an edit opens the step again). */
export const settled = (state: Pick<Project['steps'][StepId], 'status' | 'confirmed' | 'block'>) =>
  isConfirmed(state.status) && !!state.confirmed && sameBlock(state.confirmed.block, state.block)

export type EarlierChange = {
  step: StepId
  /** The version this step was built on. */
  then: Snapshot
  /** The latest confirmed version. */
  now: Snapshot
  /** Step 0 with only the measurement frame changed (the banner says "Messrahmen"). */
  frameOnly: boolean
}

/** The earlier steps that changed since this step was confirmed, in step order (only an outdated step has any). */
export function earlierChanges(project: Project, step: StepId): EarlierChange[] {
  const by = project.steps[step].outdatedBy ?? {}
  return stepIds.flatMap((s) => {
    const then = by[s]
    const confirmed = project.steps[s].confirmed
    if (!then || !confirmed) return []
    const now = { at: confirmed.at, block: confirmed.block as Record<string, unknown> }
    return [{ step: s, then, now, frameOnly: s === 0 && !changed(then.block, now.block, 'profile') }]
  })
}

/** The later steps still outdated because of this step (the confirmed gate's cascade line). */
export const outdatedBecauseOf = (project: Project, step: StepId): StepId[] =>
  later(step + 1).filter((s) => project.steps[s].status === 'maybe_outdated' && project.steps[s].outdatedBy?.[step])

/** "Schritt 2", "Schritt 0 und 2", "Schritt 0, 1 und 2". */
export function stepList(steps: StepId[]): string {
  const head = steps.slice(0, -1)
  return `Schritt ${head.length ? `${head.join(', ')} und ` : ''}${steps.at(-1)}`
}
