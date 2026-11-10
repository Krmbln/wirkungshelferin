import type { Project, StepState } from './schemas/project'
import type { StepId } from './types'

// "Wo du aufgehört hast" (design §6.1 "Step 22"): the last active step is the one whose stored
// state changed while it was on screen, and its home summary is written once Lukas has left it.

export type Resume = NonNullable<StepState['resume']>

/** The step's state as Lukas's work changed it: its own home summary doesn't count as work. */
function work(state: StepState): string {
  const { resume: _resume, ...rest } = state
  return JSON.stringify(rest)
}

/**
 * Lukas worked in `step` between the two versions. Compared by content: an answer for another
 * step clones the whole project (commitAnswer), which alone is no work here.
 */
export function activityChanged(before: Project, after: Project, step: StepId): boolean {
  const a = before.steps[step]
  const b = after.steps[step]
  return a !== b && work(a) !== work(b)
}

export const markActive = (project: Project, step: StepId, at: string): Project => ({ ...project, lastActive: { stepId: step, at } })

export function withResume(project: Project, step: StepId, resume: Resume): Project {
  return { ...project, steps: { ...project.steps, [step]: { ...project.steps[step], resume } } }
}

const messagesOf = (state: StepState) => state.segments.flatMap((s) => s.messages)
const answered = (state: StepState) => messagesOf(state).some((m) => m.role === 'assistant' && !m.aborted)

/**
 * When the step last changed, as far as the project knows: its newest stored message (an answer
 * can land after Lukas left), or the last time he worked in it. A summary is stamped with this.
 */
export function activityAt(project: Project, step: StepId): string | undefined {
  const newest = messagesOf(project.steps[step]).at(-1)?.at
  const active = project.lastActive?.stepId === step ? project.lastActive.at : undefined
  return newest && active ? (newest > active ? newest : active) : (newest ?? active)
}

/** The step's summary, when it covers the step's newest activity. */
export function resumeCurrent(project: Project, step: StepId): Resume | undefined {
  const resume = project.steps[step].resume
  const newest = activityAt(project, step)
  return resume && (!newest || resume.at >= newest) ? resume : undefined
}

/**
 * The last active step, when its summary is due: not confirmed, at least one answer to sum up,
 * and newer work than its summary covers. Where Lukas is and what still runs, the caller checks.
 */
export function resumeDue(project: Project): StepId | undefined {
  const active = project.lastActive
  if (!active) return undefined
  const state = project.steps[active.stepId]
  if (state.status === 'confirmed' || !answered(state)) return undefined
  return resumeCurrent(project, active.stepId) ? undefined : active.stepId
}
