import { stepOf, touched } from './block'
import type { Item } from './schemas/blocks'
import type { Project } from './schemas/project'
import type { StepId } from './types'

// A target group's content in later steps (PRD F5): steps 2–4 hang their items on a group
// by `groupId`. Removing a group that has such content asks first (design §6.2, step 11).

const GROUP_STEPS = [2, 3, 4] as const satisfies readonly StepId[]

const ofGroup = (item: Item, groupId: string) => item.groupId === groupId

/** How many step 2–4 items belong to the group, per step (steps without any are left out). */
export function groupContent(project: Project, groupId: string): Partial<Record<StepId, number>> {
  const counts: Partial<Record<StepId, number>> = {}
  for (const step of GROUP_STEPS) {
    const n = Object.values(stepOf(project, step).block)
      .flatMap((slot) => (Array.isArray(slot) ? slot : []))
      .filter((item) => ofGroup(item, groupId)).length
    if (n) counts[step] = n
  }
  return counts
}

/**
 * Hard delete (after the dialog): the group and its step 2–4 items go. References from
 * steps 5–6 stay and show "Verweis fehlt". Only step 1 counts as changed; what the removal
 * means for later steps is change handling (step 21), not a silent status change here.
 */
export function deleteTargetGroup(project: Project, groupId: string): Project {
  if (!project.steps[1].block.targetGroups.some((g) => g.id === groupId)) return project
  const next = structuredClone(project)
  const step1 = next.steps[1]
  step1.block.targetGroups = step1.block.targetGroups.filter((g) => g.id !== groupId)
  step1.status = touched(step1.status)
  for (const step of GROUP_STEPS) {
    const block = stepOf(next, step).block
    for (const [name, slot] of Object.entries(block)) {
      if (Array.isArray(slot)) block[name] = slot.filter((item) => !ofGroup(item, groupId))
    }
  }
  return next
}
