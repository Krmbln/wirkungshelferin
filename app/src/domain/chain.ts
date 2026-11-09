import type { LooseBlock } from './block'
import type { Item } from './schemas/blocks'
import type { Project } from './schemas/project'

// Step 4's chain per focus group (design §6.2 "Step 18"): links run from an activity (level 0)
// over the outputs (Stufen 1–3) to step 3's goals (Stufen 4–6), always upwards. Pure helpers
// shared by the check, the tool rules and the panel. Bad data (a deleted end, a link to
// itself, a loop) never hangs anything: the order is a plain sort, never a graph walk.

/** At most this many critical assumptions per focus group (guide §4.3). */
export const CRITICAL_MAX = 2

/** Output levels, in the panel's reading order (forward, guide §4.4). */
export const OUTPUT_LEVELS = [1, 2, 3] as const
export type OutputLevel = (typeof OUTPUT_LEVELS)[number]

/** What a link can point to, as the chain sees it. */
export type ChainItems = { activities: Item[]; outputs: Item[]; goals: Item[]; marks: Item[] }

export type End = { kind: 'activity' | 'output' | 'goal'; item: Item; level: number }

/** Step 4's lists (from `block`, by default the stored one) and step 3's goals and marks. */
export function chainItems(project: Project, block?: LooseBlock): ChainItems {
  const own = block ?? (project.steps[4].block as unknown as LooseBlock)
  return {
    activities: (own.activities as Item[]) ?? [],
    outputs: (own.outputs as Item[]) ?? [],
    goals: project.steps[3].block.goals as Item[],
    marks: project.steps[3].block.levelNotApplicable as Item[],
  }
}

/** The item an end id names, if it exists and may sit in `groupId`'s chain (activities are shared). */
export function endOf(items: ChainItems, groupId: string, id: unknown): End | undefined {
  if (typeof id !== 'string' || !id) return undefined
  const activity = items.activities.find((a) => a.id === id)
  if (activity) return { kind: 'activity', item: activity, level: 0 }
  const output = items.outputs.find((o) => o.id === id && o.groupId === groupId)
  if (output) return { kind: 'output', item: output, level: output.level as number }
  const goal = items.goals.find((g) => g.id === id && g.groupId === groupId)
  if (goal) return { kind: 'goal', item: goal, level: goal.level as number }
  return undefined
}

/** Which ends of a link are missing ('' never set), gone (deleted or in another group) or point the wrong way. */
export type LinkState = { from?: End; to?: End; fromMissing: boolean; toMissing: boolean; upward: boolean }

export function linkState(items: ChainItems, link: Item): LinkState {
  const groupId = link.groupId as string
  const from = endOf(items, groupId, link.fromId)
  const to = endOf(items, groupId, link.toId)
  // A start can't be an activity's end or a Stufe 6 goal; an end can't be an activity.
  const validFrom = from && from.level <= 5 ? from : undefined
  const validTo = to && to.kind !== 'activity' ? to : undefined
  return { from: validFrom, to: validTo, fromMissing: !validFrom, toMissing: !validTo, upward: !!validFrom && !!validTo && validTo.level > validFrom.level }
}

/** A link the chain can't use: an end missing, gone, or not above the start (design: ⚠ "Verbindung unvollständig"). */
export const incomplete = (items: ChainItems, link: Item) => !linkState(items, link).upward

/**
 * One group's links in chain order: by the start's level, then the end's level, then list
 * order. An unknown end sorts last on its side. A plain sort, so a link to itself or a loop
 * terminates like any other row.
 */
export function chainOf(items: ChainItems, links: Item[], groupId: string): Item[] {
  const level = (id: unknown) => endOf(items, groupId, id)?.level ?? 99
  return links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => link.groupId === groupId)
    .sort((a, b) => level(a.link.fromId) - level(b.link.fromId) || level(a.link.toId) - level(b.link.toId) || a.index - b.index)
    .map(({ link }) => link)
}

/**
 * Levels a link jumps over that the group has filled and not marked "trifft nicht zu" (a
 * reading aid, "überspringt Stufe 2"; the verdict on criterion 1 is Claude's).
 */
export function skippedLevels(items: ChainItems, link: Item): number[] {
  const state = linkState(items, link)
  if (!state.upward) return []
  const groupId = link.groupId as string
  const skipped: number[] = []
  for (let level = state.from!.level + 1; level < state.to!.level; level++) {
    const filled = level <= 3 ? items.outputs.some((o) => o.groupId === groupId && o.level === level) : items.goals.some((g) => g.groupId === groupId && g.level === level)
    const marked = items.marks.some((m) => m.groupId === groupId && m.level === level)
    if (filled && !marked) skipped.push(level)
  }
  return skipped
}

/** The group's outputs no link touches and goals no link reaches (cue lines, design "Step 18"). */
export function unlinked(items: ChainItems, links: Item[], groupId: string): { outputs: Item[]; goals: Item[] } {
  const own = links.filter((l) => l.groupId === groupId)
  const touched = new Set(own.flatMap((l) => [l.fromId, l.toId]))
  const reached = new Set(own.map((l) => l.toId))
  return {
    outputs: items.outputs.filter((o) => o.groupId === groupId && !touched.has(o.id)),
    goals: items.goals.filter((g) => g.groupId === groupId && !reached.has(g.id)),
  }
}

/** Ids of the focus groups whose chain starts at an activity (its usage line). */
export function activityUse(links: Item[], activityId: string, focusIds: string[]): string[] {
  return focusIds.filter((id) => links.some((l) => l.groupId === id && l.fromId === activityId))
}

/** Links marked critical in one group, in chain order. */
export const criticalLinks = (items: ChainItems, links: Item[], groupId: string) => chainOf(items, links, groupId).filter((l) => l.critical)

/** Links of any group that point to `id` (the undo line after removing an activity or output). */
export const linksUsing = (links: Item[], id: string) => links.filter((l) => l.fromId === id || l.toId === id)
