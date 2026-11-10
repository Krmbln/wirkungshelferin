import { stepOf } from './block'
import type { Item } from './schemas/blocks'
import type { Project } from './schemas/project'
import type { StepId } from './types'

// Steps 2–4 hang their items on a step 1 target group (`groupId`) and are worked per focus
// group (PRD F5, design §6.2 "Multi-group layout"). Step 2's causes and consequences also form
// a tree: `parentId` is another item of the same list and group, '' = directly at the core
// problem. Pure helpers shared by the reducer, proposals, the check and the panel.

/** Per step: which collections a non-focus group keeps (the rest is hidden for it). */
export const NON_FOCUS_KEEPS: Partial<Record<StepId, string[]>> = { 2: ['problems'], 3: ['goals', 'level7'], 4: ['externalFactors'] }

/**
 * Step 4's lists that sit inside a focus group's panel section. Its external factors carry a
 * `groupId` too ('' = all focus groups), but are shown project-wide (design "Step 18").
 */
const PROJECT_WIDE: Partial<Record<StepId, string[]>> = { 4: ['externalFactors'] }

/** Collections with `parentId` nesting, per step. */
export const TREES: Partial<Record<StepId, string[]>> = { 2: ['causes', 'consequences'] }

/** Direct, below it, below that (design: deeper nesting is refused). */
export const MAX_DEPTH = 3

export const isTree = (step: StepId, collection: string) => !!TREES[step]?.includes(collection)

export const targetGroups = (project: Project): Item[] => project.steps[1].block.targetGroups as Item[]

/** The step's groups as the panel shows them: focus groups in step 1 order, the rest, and ids of vanished groups. */
export function stepGroups(project: Project, step: StepId): { focus: Item[]; other: Item[]; orphans: string[] } {
  const groups = targetGroups(project)
  const known = new Set(groups.map((g) => g.id))
  const orphans = new Set<string>()
  for (const slot of Object.values(stepOf(project, step).block)) {
    if (!Array.isArray(slot)) continue
    for (const item of slot) if (typeof item.groupId === 'string' && item.groupId && !known.has(item.groupId)) orphans.add(item.groupId)
  }
  return { focus: groups.filter((g) => g.isFocus), other: groups.filter((g) => !g.isFocus), orphans: [...orphans] }
}

/**
 * Hidden: the item belongs to a group that exists but is no longer a focus group, and the
 * collection is one non-focus groups don't keep. Hidden items count for nothing.
 */
export function isHidden(groups: Item[], step: StepId, collection: string, item: Record<string, unknown>): boolean {
  const group = groups.find((g) => g.id === item.groupId)
  return !!group && !group.isFocus && !NON_FOCUS_KEEPS[step]?.includes(collection)
}

/** Items of one list that belong to a group. */
export const ofGroup = (items: Item[], groupId: string) => items.filter((i) => i.groupId === groupId)

/**
 * 1 for a direct item. A missing parent counts as direct, and a cycle ends where it closes,
 * so bad data never hangs or hides an item.
 */
export function depthOf(items: Item[], item: Item): number {
  const seen = new Set([item.id])
  let depth = 1
  let parent = item.parentId as string
  while (parent) {
    const next = items.find((i) => i.id === parent)
    if (!next || seen.has(next.id)) break
    seen.add(next.id)
    depth++
    parent = next.parentId as string
  }
  return depth
}

export type TreeRow = { item: Item; depth: number; children: TreeRow[] }

/** One group's list as a tree in list order; items whose parent is missing (or in a cycle) are roots. */
export function treeOf(items: Item[]): TreeRow[] {
  const ids = new Set(items.map((i) => i.id))
  const isRoot = (i: Item) => !i.parentId || !ids.has(i.parentId as string) || inCycle(items, i)
  const build = (item: Item, depth: number, path: Set<string>): TreeRow => ({
    item,
    depth,
    children: items
      .filter((c) => c.parentId === item.id && !path.has(c.id) && !isRoot(c))
      .map((c) => build(c, depth + 1, new Set([...path, c.id]))),
  })
  return items.filter(isRoot).map((i) => build(i, 1, new Set([i.id])))
}

function inCycle(items: Item[], item: Item): boolean {
  const seen = new Set<string>()
  let current: Item | undefined = item
  while (current?.parentId) {
    if (seen.has(current.id)) return true
    seen.add(current.id)
    current = items.find((i) => i.id === current!.parentId)
    if (current?.id === item.id) return true
  }
  return false
}

/** How many levels hang below an item (0 for a leaf). */
export function heightOf(items: Item[], item: Item, seen = new Set<string>()): number {
  if (seen.has(item.id)) return 0
  seen.add(item.id)
  const children = items.filter((c) => c.parentId === item.id)
  return children.length ? 1 + Math.max(...children.map((c) => heightOf(items, c, seen))) : 0
}

/**
 * Removing an item moves its children one level up (to the removed item's parent). Mutates
 * `list` and returns the moved ids, so an undo can put them back. Revs stay: the move is a
 * consequence of the removal, not an edit of the children.
 */
export function detachChildren(list: Item[], removed: Item): string[] {
  const moved: string[] = []
  for (const item of list) {
    if (item.parentId !== removed.id) continue
    item.parentId = (removed.parentId as string) ?? ''
    moved.push(item.id)
  }
  return moved
}

/** The undo of detachChildren: the moved children hang under the restored item again. */
export function reattachChildren(list: Item[], restored: Item, moved: string[]): void {
  for (const item of list) if (moved.includes(item.id) && item.parentId === ((restored.parentId as string) ?? '')) item.parentId = restored.id
}

/**
 * The panel group an item (or a not yet created core problem "problem:tg1") sits in: its focus
 * group's id, "other" (non-focus groups) or "orphans"; undefined outside steps 2–4 lists.
 * Step 6: a plan row is its own disclosure (design "Step 20"), so its key is its id.
 */
export function panelGroupOf(project: Project, step: StepId, id: string): string | undefined {
  if (step === 6) return (project.steps[6].block.planRows as Item[]).some((r) => r.id === id) ? id : undefined
  if (!NON_FOCUS_KEEPS[step]) return undefined
  let groupId = id.startsWith('problem:') ? id.slice('problem:'.length) : undefined
  if (!groupId) {
    for (const [name, slot] of Object.entries(stepOf(project, step).block)) {
      const item = Array.isArray(slot) ? slot.find((i) => i.id === id) : undefined
      if (item && !PROJECT_WIDE[step]?.includes(name)) groupId = item.groupId as string | undefined
    }
  }
  return groupId ? panelKey(project, groupId) : undefined
}

/** The panel group of a step 1 target group: its own id (focus), "other" or "orphans". */
export function panelKey(project: Project, groupId: string): string {
  const group = targetGroups(project).find((g) => g.id === groupId)
  return !group ? 'orphans' : group.isFocus ? group.id : 'other'
}

/** Step 3's levels per focus group, top to bottom (the guide works from the central goal down). */
export const GOAL_LEVELS = [6, 5, 4] as const
export type GoalLevel = (typeof GOAL_LEVELS)[number]
