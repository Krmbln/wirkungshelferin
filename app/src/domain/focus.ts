import type { LooseBlock } from './block'
import { chainItems, chainOf, endOf } from './chain'
import type { Item } from './schemas/blocks'
import type { Project } from './schemas/project'
import type { StepId } from './types'
import { targetGroups } from './tree'

// Step 5 (design §6.2 "Step 19"): the measurement focus. Candidates are step 4's critical
// links with weak evidence, derived every time (never copied); a question tests links and goals
// of focus groups and carries 1–2 indicators. Pure helpers shared by the reducer, the check,
// the tool rules and the panel.

export const QUESTION_MAX = 3
export const PER_QUESTION_MAX = 2
export const INDICATOR_MAX = 6

/** Evidence that makes a critical assumption a candidate (PRD F4/F5). */
const WEAK_EVIDENCE = ['unsicher', 'eigene_erfahrung']

const list = (block: LooseBlock, name: string) => (block[name] as Item[] | undefined) ?? []
export const questionsOf = (block: LooseBlock) => list(block, 'focusQuestions')
export const indicatorsOf = (block: LooseBlock, questionId: string) => list(block, 'indicators').filter((i) => i.focusQuestionId === questionId)
/** Indicators whose question doesn't exist (bad data only: removing a question takes its indicators). */
export const orphanIndicators = (block: LooseBlock) => {
  const ids = new Set(questionsOf(block).map((q) => q.id))
  return list(block, 'indicators').filter((i) => !ids.has(i.focusQuestionId as string))
}

export const isCandidate = (link: Item) => !!link.critical && WEAK_EVIDENCE.includes(link.evidence as string)

export type Candidate = { link: Item; group: Item }

/** The candidates in panel order: focus groups in step 1 order, each in chain order. */
export function candidates(project: Project): Candidate[] {
  const items = chainItems(project)
  const links = project.steps[4].block.links as Item[]
  return targetGroups(project)
    .filter((g) => g.isFocus)
    .flatMap((group) =>
      chainOf(items, links, group.id)
        .filter(isCandidate)
        .map((link) => ({ link, group })),
    )
}

export type Decision = { kind: 'open' } | { kind: 'included'; questions: number[] } | { kind: 'deferred'; deferral: Item }

/** A candidate's decision; being tested by a question wins over a deferral (which then can't exist, see the tool rules). */
export function decisionOf(block: LooseBlock, linkId: string): Decision {
  const questions = questionsOf(block).flatMap((q, i) => ((q.linkIds as string[]).includes(linkId) ? [i + 1] : []))
  if (questions.length) return { kind: 'included', questions }
  const deferral = list(block, 'deferredCandidates').find((d) => d.linkId === linkId)
  return deferral ? { kind: 'deferred', deferral } : { kind: 'open' }
}

export type OldCause = 'removed' | 'hidden' | 'notCritical' | 'evidence' | 'duplicate'

/** Deferrals that no longer belong to a candidate, with why (design: nothing disappears silently). */
export function oldDeferrals(project: Project, block: LooseBlock): { deferral: Item; cause: OldCause; evidence?: string }[] {
  const links = project.steps[4].block.links as Item[]
  const groups = targetGroups(project)
  const current = new Set(candidates(project).map((c) => c.link.id))
  const seen = new Set<string>()
  const old: { deferral: Item; cause: OldCause; evidence?: string }[] = []
  for (const deferral of list(block, 'deferredCandidates')) {
    const id = deferral.linkId as string
    const link = links.find((l) => l.id === id)
    if (current.has(id) && !seen.has(id)) {
      seen.add(id)
      continue
    }
    if (current.has(id)) old.push({ deferral, cause: 'duplicate' })
    else if (!link) old.push({ deferral, cause: 'removed' })
    else if (!groups.find((g) => g.id === link.groupId)?.isFocus) old.push({ deferral, cause: 'hidden' })
    else if (!link.critical) old.push({ deferral, cause: 'notCritical' })
    else old.push({ deferral, cause: 'evidence', evidence: link.evidence as string })
  }
  return old
}

/** A question's reference as the panel shows it; `item` missing = deleted or no longer in a focus group ("Verweis fehlt"). */
export type Ref = { kind: 'link' | 'goal'; id: string; item?: Item; group?: Item }

export function refsOf(project: Project, question: Item): Ref[] {
  const focus = targetGroups(project).filter((g) => g.isFocus)
  const find = (items: Item[], id: string) => {
    const item = items.find((i) => i.id === id)
    const group = item && focus.find((g) => g.id === item.groupId)
    return group ? { item, group } : {}
  }
  return [
    ...(question.linkIds as string[]).map((id): Ref => ({ kind: 'link', id, ...find(project.steps[4].block.links as Item[], id) })),
    ...(question.goalIds as string[]).map((id): Ref => ({ kind: 'goal', id, ...find(project.steps[3].block.goals as Item[], id) })),
  ]
}

/** A new indicator's level: its question's first reference (a goal's level, a link's end), else Stufe 4. Set once. */
export function defaultLevel(project: Project, question: Item | undefined): number {
  const first = question ? refsOf(project, question).find((r) => r.item) : undefined
  if (!first) return 4
  if (first.kind === 'goal') return first.item!.level as number
  return endOf(chainItems(project), first.item!.groupId as string, first.item!.toId)?.level ?? 4
}

/** With two or more focus groups: those no question tests (the cue line; criterion 10a stays Claude's). */
export function uncoveredGroups(project: Project, block: LooseBlock): Item[] {
  const focus = targetGroups(project).filter((g) => g.isFocus)
  const questions = questionsOf(block)
  if (focus.length < 2 || !questions.length) return []
  const covered = new Set(questions.flatMap((q) => refsOf(project, q).flatMap((r) => (r.group ? [r.group.id] : []))))
  return focus.filter((g) => !covered.has(g.id))
}

/** Why one more question or indicator doesn't fit (`questionId`: the indicator's question), or undefined. */
export type Full = 'questions' | 'perQuestion' | 'total'

export function fullFor(block: LooseBlock, collection: string, questionId?: string, except?: string): Full | undefined {
  if (collection === 'focusQuestions') return questionsOf(block).length >= QUESTION_MAX ? 'questions' : undefined
  if (collection !== 'indicators') return undefined
  const others = (items: Item[]) => items.filter((i) => i.id !== except)
  if (questionId && others(indicatorsOf(block, questionId)).length >= PER_QUESTION_MAX) return 'perQuestion'
  if (others(list(block, 'indicators')).length >= INDICATOR_MAX) return 'total'
  return undefined
}

export type Dependent = { collection: string; index: number; item: Item }

/**
 * Removing a step 5 question removes its indicators too (design "Step 19"). Mutates `block`
 * and returns what went, with each item's place, so an undo can put them back.
 */
export function removeDependents(step: StepId, block: LooseBlock, collection: string, removed: Item): Dependent[] {
  if (step !== 5 || collection !== 'focusQuestions') return []
  const indicators = list(block, 'indicators')
  const gone: Dependent[] = []
  indicators.forEach((item, index) => {
    if (item.focusQuestionId === removed.id) gone.push({ collection: 'indicators', index, item })
  })
  block.indicators = indicators.filter((i) => i.focusQuestionId !== removed.id)
  return gone
}

/** The undo of removeDependents: each item back at its place (skips one that is already there). */
export function restoreDependents(block: LooseBlock, dependents: Dependent[]): void {
  for (const { collection, index, item } of [...dependents].sort((a, b) => a.index - b.index)) {
    const target = list(block, collection)
    if (target.some((i) => i.id === item.id)) continue
    target.splice(Math.min(index, target.length), 0, item)
    block[collection] = target
  }
}
