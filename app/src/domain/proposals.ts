import { existedBefore, findItem, newItem, nextId, putItem, stepOf, touched, validItem } from './block'
import { collectionMeta, type Item } from './schemas/blocks'
import { fullFor, removeDependents, restoreDependents, type Dependent, type Full } from './focus'
import { detachChildren, isHidden, isTree, reattachChildren, targetGroups } from './tree'
import { TEMP_ID, type Project, type Proposal, type ProposalChange } from './schemas/project'
import type { StepId } from './types'

// Proposals and the ownership rule (tech design §6.4, PRD F4).
// Only Lukas's click applies a change. "Veraltet" is derived from the block every time,
// so an old proposal can never overwrite a manual edit and the state can't drift.

export type StaleReason =
  | 'edited' // the target changed since the assistant saw it
  | 'removed' // the target was deleted
  | 'unknown_target' // the id never existed (or an unknown temp id)
  | 'creator_unavailable' // the change that creates a referenced item was rejected or is stale
  | 'invalid' // fields don't fit the collection, or the change can't apply to it
  | 'hidden' // belongs to a group that is no longer a focus group (steps 2–4)

export type ChangeView =
  | { kind: 'open' }
  | { kind: 'blocked'; needs: string } // id of the change that must be applied first (creates an item, or removes one in the way)
  | { kind: 'blocked'; full: Full } // step 5: one more question or indicator doesn't fit now (Lukas added some by hand since)
  | { kind: 'stale'; reason: StaleReason }
  | { kind: 'applied' }
  | { kind: 'rejected' }

const BOOKKEEPING = ['id', 'rev', 'editedByUser']

function findProposal(project: Project, step: StepId, proposalId: string): Proposal | undefined {
  return project.steps[step].proposals.find((p) => p.id === proposalId)
}

/** Temp ids a change points to, in its target and anywhere in its fields. */
function tempRefs(change: ProposalChange): string[] {
  const found = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (TEMP_ID.test(value) && value !== change.tempId) found.add(value)
    } else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  if (change.targetId) walk(change.targetId)
  walk(change.fields)
  return [...found]
}

/** Temp id → real id, for the adds of this proposal that are applied. */
function tempMap(proposal: Proposal): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of proposal.changes) if (c.op === 'add' && c.state === 'applied' && c.tempId && c.resultId) map.set(c.tempId, c.resultId)
  return map
}

function resolve<T>(value: T, map: Map<string, string>): T {
  if (typeof value === 'string') return (map.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map((v) => resolve(v, map)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, map)])) as T
  }
  return value
}

function targetOf(change: ProposalChange, map: Map<string, string>): string | undefined {
  return change.op === 'add' ? change.resultId : change.targetId && (map.get(change.targetId) ?? change.targetId)
}

/**
 * The rev the target must have. Changes of the same proposal to the same item are chained:
 * after one is applied, the next expects the rev it left behind (so "Alle übernehmen"
 * doesn't make its own changes stale).
 */
function expectedRev(proposal: Proposal, change: ProposalChange, target: string, map: Map<string, string>) {
  const after = proposal.changes
    .filter((o) => o !== change && o.state === 'applied' && o.undo && targetOf(o, map) === target)
    .map((o) => o.undo!.afterRev)
  return after.length ? Math.max(...after) : change.baseRev
}

function view(project: Project, step: StepId, proposal: Proposal, change: ProposalChange, visiting: Set<string>): ChangeView {
  if (change.state === 'applied') return { kind: 'applied' }
  if (change.state === 'rejected') return { kind: 'rejected' }

  const meta = collectionMeta(step, change.collection)
  if (!meta) return { kind: 'stale', reason: 'invalid' }
  if (meta.singleton && change.op !== 'update') return { kind: 'stale', reason: 'invalid' }
  if (change.fields && BOOKKEEPING.some((k) => k in change.fields!)) return { kind: 'stale', reason: 'invalid' }

  // Dependencies on items created by this proposal.
  visiting.add(change.id)
  for (const temp of tempRefs(change)) {
    const creator = proposal.changes.find((c) => c.op === 'add' && c.tempId === temp)
    if (!creator) return { kind: 'stale', reason: 'unknown_target' }
    if (creator.state === 'applied') continue
    if (creator.state === 'rejected' || visiting.has(creator.id)) return { kind: 'stale', reason: 'creator_unavailable' }
    const creatorView = view(project, step, proposal, creator, visiting)
    if (creatorView.kind === 'stale') return { kind: 'stale', reason: 'creator_unavailable' }
    return { kind: 'blocked', needs: creator.id }
  }

  const map = tempMap(proposal)
  const block = stepOf(project, step).block
  const fields = resolve(change.fields ?? {}, map)

  // A parent that is gone (or never existed) would leave the item hanging nowhere.
  const parent = fields.parentId
  if (isTree(step, change.collection) && typeof parent === 'string' && parent && !findItem(block, change.collection, parent)) {
    return { kind: 'stale', reason: 'invalid' }
  }

  if (change.op === 'add') {
    if (isHidden(targetGroups(project), step, change.collection, fields)) return { kind: 'stale', reason: 'hidden' }
    const clash = levelClash(project, step, proposal, change, fields) ?? deferralClash(project, step, proposal, change, fields)
    if (clash) return clash
    const full = step === 5 ? fullFor(block, change.collection, fields.focusQuestionId as string | undefined) : undefined
    if (full) return { kind: 'blocked', full }
    // Validate with a placeholder id; the real one is handed out on apply.
    return newItem(step, change.collection, `${meta.prefix}0`, fields, false) ? { kind: 'open' } : { kind: 'stale', reason: 'invalid' }
  }

  const target = targetOf(change, map)!
  const found = findItem(block, change.collection, target)
  if (!found) {
    return { kind: 'stale', reason: existedBefore(project, step, change.collection, target) ? 'removed' : 'unknown_target' }
  }
  if (isHidden(targetGroups(project), step, change.collection, { ...found.item, ...fields })) return { kind: 'stale', reason: 'hidden' }
  if (found.item.rev !== expectedRev(proposal, change, target, map)) return { kind: 'stale', reason: 'edited' }
  const clash =
    change.op === 'update' ? (levelClash(project, step, proposal, change, { ...found.item, ...fields }) ?? deferralClash(project, step, proposal, change, { ...found.item, ...fields })) : undefined
  if (clash) return clash
  // Moving an indicator to another question must fit there too.
  const moved = step === 5 && change.op === 'update' && change.collection === 'indicators' && fields.focusQuestionId !== undefined && fields.focusQuestionId !== found.item.focusQuestionId
  const full = moved ? fullFor(block, 'indicators', fields.focusQuestionId as string, found.item.id) : undefined
  if (full === 'perQuestion') return { kind: 'blocked', full }
  if (change.op === 'update' && !validItem(step, change.collection, { ...found.item, ...fields })) {
    return { kind: 'stale', reason: 'invalid' }
  }
  return { kind: 'open' }
}

/**
 * Step 3: a level has goals or a "trifft nicht zu" mark, never both (design "Step 17"). A
 * change that would make both waits for a removal of the other in the same proposal, else
 * it can't apply.
 */
function levelClash(project: Project, step: StepId, proposal: Proposal, change: ProposalChange, item: Record<string, unknown>): ChangeView | undefined {
  if (step !== 3) return undefined
  const block = project.steps[3].block
  const goal = change.collection === 'goals'
  if (!goal && change.collection !== 'levelNotApplicable') return undefined
  if (goal && !item.text) return undefined
  const sameLevel = (i: { groupId: string; level: number }) => i.groupId === item.groupId && i.level === item.level
  const inWay = goal ? block.levelNotApplicable.filter(sameLevel) : block.goals.filter((g) => sameLevel(g) && g.text)
  if (!inWay.length) return undefined
  const other = goal ? 'levelNotApplicable' : 'goals'
  for (const blocker of inWay) {
    const removal = proposal.changes.find((c) => c.op === 'remove' && c.collection === other && c.targetId === blocker.id && c.state !== 'applied')
    // A removal never runs levelClash itself, so this can't loop.
    if (!removal || changeView(project, step, proposal.id, removal.id).kind !== 'open') return { kind: 'stale', reason: 'invalid' }
    return { kind: 'blocked', needs: removal.id }
  }
  return undefined
}

/**
 * Step 5: a candidate is tested by a question or deferred, never both (design "Step 19"). A
 * question that tests a deferred link waits for the deferral's removal in the same proposal.
 */
function deferralClash(project: Project, step: StepId, proposal: Proposal, change: ProposalChange, item: Record<string, unknown>): ChangeView | undefined {
  if (step !== 5 || change.collection !== 'focusQuestions' || !Array.isArray(item.linkIds)) return undefined
  const inWay = project.steps[5].block.deferredCandidates.filter((d) => (item.linkIds as string[]).includes(d.linkId))
  for (const blocker of inWay) {
    const removal = proposal.changes.find((c) => c.op === 'remove' && c.collection === 'deferredCandidates' && c.targetId === blocker.id && c.state !== 'applied')
    if (!removal || changeView(project, step, proposal.id, removal.id).kind !== 'open') return { kind: 'stale', reason: 'invalid' }
    return { kind: 'blocked', needs: removal.id }
  }
  return undefined
}

export function changeView(project: Project, step: StepId, proposalId: string, changeId: string): ChangeView {
  const proposal = findProposal(project, step, proposalId)
  const change = proposal?.changes.find((c) => c.id === changeId)
  // An unknown proposal or change can't be applied; treat it like an unknown target.
  if (!proposal || !change) return { kind: 'stale', reason: 'unknown_target' }
  return view(project, step, proposal, change, new Set())
}

/** Applies one change if it is open; otherwise returns the project unchanged. */
export function applyChange(project: Project, step: StepId, proposalId: string, changeId: string): Project {
  if (changeView(project, step, proposalId, changeId).kind !== 'open') return project

  const next = structuredClone(project)
  const state = stepOf(next, step)
  const proposal = findProposal(next, step, proposalId)!
  const change = proposal.changes.find((c) => c.id === changeId)!
  const map = tempMap(proposal)
  const fields = resolve(change.fields ?? {}, map)
  const block = state.block

  if (change.op === 'add') {
    const id = nextId(next, collectionMeta(step, change.collection)!.prefix)
    const list = block[change.collection] as Item[]
    list.push(newItem(step, change.collection, id, fields, false)!)
    change.resultId = id
    change.undo = { before: null, index: list.length - 1, afterRev: 1 }
  } else {
    const target = targetOf(change, map)!
    const { item, index } = findItem(block, change.collection, target)!
    if (change.op === 'update') {
      const updated = validItem(step, change.collection, { ...item, ...fields, rev: item.rev + 1 })!
      putItem(block, change.collection, updated, index)
      change.undo = { before: item, index: Math.max(index, 0), afterRev: updated.rev }
    } else {
      const list = block[change.collection] as Item[]
      list.splice(index, 1)
      const children = isTree(step, change.collection) ? detachChildren(list, item) : []
      const dependents = removeDependents(step, block, change.collection, item)
      change.undo = { before: item, index, afterRev: item.rev, ...(children.length ? { children } : {}), ...(dependents.length ? { dependents } : {}) }
    }
  }
  change.state = 'applied'
  state.status = touched(state.status)
  return next
}

/** "Alle übernehmen": every open change in order; repeats so dependents follow their creators. */
export function applyAll(project: Project, step: StepId, proposalId: string): Project {
  let current = project
  for (;;) {
    const proposal = findProposal(current, step, proposalId)
    if (!proposal) return current
    const before = current
    for (const change of proposal.changes) current = applyChange(current, step, proposalId, change.id)
    if (current === before) return current
  }
}

export function rejectChange(project: Project, step: StepId, proposalId: string, changeId: string): Project {
  const kind = changeView(project, step, proposalId, changeId).kind
  if (kind === 'applied' || kind === 'rejected') return project
  return setChange(project, step, proposalId, changeId, (c) => (c.state = 'rejected'))
}

/**
 * Why an applied change can't be undone, or null if it can. A later edit or a change that
 * builds on it blocks the undo, so "Rückgängig" never throws away other work.
 */
function undoBlocker(project: Project, step: StepId, proposal: Proposal, change: ProposalChange): string | null {
  if (change.state !== 'applied' || !change.undo) return 'not_applied'
  const block = stepOf(project, step).block
  const map = tempMap(proposal)
  const target = targetOf(change, map)!
  const found = findItem(block, change.collection, target)
  if (change.op === 'remove') return found ? 'target_back' : null
  if (!found || found.item.rev !== change.undo.afterRev) return 'edited_since'
  const builtOn = proposal.changes.some(
    (o) => o !== change && o.state === 'applied' && (tempRefs(o).includes(change.tempId ?? '') || (o.op !== 'add' && targetOf(o, map) === target)),
  )
  return builtOn ? 'built_on' : null
}

export function canUndo(project: Project, step: StepId, proposalId: string, changeId: string): boolean {
  const proposal = findProposal(project, step, proposalId)
  const change = proposal?.changes.find((c) => c.id === changeId)
  if (!proposal || !change) return false
  return change.state === 'rejected' || undoBlocker(project, step, proposal, change) === null
}

/** "Rückgängig": a rejected change opens again; an applied one is reverted if nothing builds on it. */
export function undoChange(project: Project, step: StepId, proposalId: string, changeId: string): Project {
  if (!canUndo(project, step, proposalId, changeId)) return project
  const next = structuredClone(project)
  const block = stepOf(next, step).block
  const proposal = findProposal(next, step, proposalId)!
  const change = proposal.changes.find((c) => c.id === changeId)!

  if (change.state === 'applied') {
    const { before, index } = change.undo!
    const target = targetOf(change, tempMap(proposal))!
    if (change.op === 'add') {
      const list = block[change.collection] as Item[]
      list.splice(list.findIndex((i) => i.id === target), 1)
      delete change.resultId
    } else if (change.op === 'update') {
      const found = findItem(block, change.collection, target)!
      // The rev keeps rising, so a proposal made after the apply sees the revert as a change.
      putItem(block, change.collection, { ...(before as Item), rev: found.item.rev + 1 }, found.index)
    } else {
      const list = block[change.collection] as Item[]
      list.splice(Math.min(index, list.length), 0, before as Item)
      if (change.undo!.children) reattachChildren(list, before as Item, change.undo!.children)
      if (change.undo!.dependents) restoreDependents(block, change.undo!.dependents as Dependent[])
    }
    delete change.undo
  }
  change.state = 'open'
  return next
}

function setChange(project: Project, step: StepId, proposalId: string, changeId: string, edit: (c: ProposalChange) => void) {
  const next = structuredClone(project)
  const change = findProposal(next, step, proposalId)?.changes.find((c) => c.id === changeId)
  if (change) edit(change)
  return next
}
