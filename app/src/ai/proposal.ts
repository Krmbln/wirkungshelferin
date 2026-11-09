import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { findItem, type LooseBlock } from '../domain/block'
import { changeView } from '../domain/proposals'
import { TEMP_ID, proposal as proposalSchema, type Project, type Proposal, type ProposalChange } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import type { Item } from '../domain/schemas/blocks'
import { MAX_DEPTH, NON_FOCUS_KEEPS, TREES, depthOf, heightOf } from '../domain/tree'
import { proposeInput, type ProposeInput } from './tools'

// From a propose_changes call to a Proposal, and from Lukas's decisions back to the
// tool_result (tech design §6.3, §6.4). The input is checked before anything is shown:
// a broken call becomes an error tool_result, never a broken card.

export type ToProposal = {
  /** The block exactly as the snapshot sent with the request showed it. */
  seen: LooseBlock
  toolUseId: string
  proposalId: string
  at: string
  /** Step 1's target groups now: steps 2–4 hang items on them (checked by `groupErrors`). */
  groups?: Item[]
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; errors: string[] }

export function toProposal(step: StepId, input: unknown, { seen, toolUseId, proposalId, at, groups = [] }: ToProposal): ProposalResult {
  const parsed = proposeInput(step).safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`) }
  }
  const { summary, changes } = parsed.data as ProposeInput
  const errors: string[] = []
  const temps = new Set<string>()
  /** Fields of the items this proposal creates, as its earlier changes leave them. */
  const created = new Map<string, Record<string, unknown>>()
  const result: ProposalChange[] = []

  changes.forEach((change, index) => {
    const n = index + 1
    const base = { id: `${proposalId}c${result.length + 1}`, collection: change.collection, state: 'open' as const }
    if (change.op === 'add') {
      if (!TEMP_ID.test(change.id)) return void errors.push(`Änderung ${n}: add braucht eine vorläufige ID wie new:1, nicht "${change.id}".`)
      if (temps.has(change.id)) return void errors.push(`Änderung ${n}: die vorläufige ID ${change.id} kommt doppelt vor.`)
      temps.add(change.id)
      created.set(change.id, change.fields!)
      result.push({ ...base, op: 'add', tempId: change.id, fields: change.fields })
      return
    }
    if (TEMP_ID.test(change.id)) {
      // A change to an item this proposal creates: diffed against the fields it is created with,
      // so the tool's required "" values never clear what the add just set.
      if (!temps.has(change.id)) return void errors.push(`Änderung ${n}: ${change.id} wird in diesem Vorschlag nicht vorher angelegt.`)
      if (change.op === 'remove') return void errors.push(`Änderung ${n}: ein neues Element im selben Vorschlag wieder zu entfernen ist nicht nötig.`)
      const before = created.get(change.id)!
      const fields = changedFields(before, change.fields!)
      if (!Object.keys(fields).length) return
      created.set(change.id, { ...before, ...fields })
      result.push({ ...base, op: 'update', targetId: change.id, fields })
      return
    }
    const found = findItem(seen, change.collection, change.id)
    if (!found) return void errors.push(`Änderung ${n}: ${change.id} gibt es in „${change.collection}“ nicht.`)
    if (change.op === 'remove') {
      result.push({ ...base, op: 'remove', targetId: change.id, baseRev: found.item.rev })
      return
    }
    const fields = changedFields(found.item, change.fields!)
    // Nothing differs from what Claude saw: no change to show.
    if (!Object.keys(fields).length) return
    result.push({ ...base, op: 'update', targetId: change.id, baseRev: found.item.rev, fields })
  })

  // A temp id in fields must be created in this proposal, or the card would only show "veraltet".
  result.forEach((change, i) => {
    for (const temp of tempIdsIn(change.fields)) {
      if (!temps.has(temp)) errors.push(`Änderung ${i + 1}: ${temp} wird in diesem Vorschlag nicht angelegt.`)
    }
  })

  if (!errors.length) errors.push(...groupErrors(step, seen, result, groups))
  if (errors.length) return { ok: false, errors }
  if (!result.length) return { ok: false, errors: ['Der Vorschlag ändert nichts am Baustein.'] }
  const proposal = proposalSchema.safeParse({ id: proposalId, toolUseId, at, summary, changes: result })
  if (!proposal.success) return { ok: false, errors: proposal.error.issues.map((i) => i.message) }
  return { ok: true, proposal: proposal.data }
}

/**
 * Steps 2–4 (design §6.2 "Step 16"): every item the proposal touches hangs on a step 1 target
 * group; a non-focus group keeps only its core problem; one core problem per group; a parent
 * is in the same list and group, at most three levels deep. Judged on the block as it would
 * look with every change applied, so the order of changes doesn't matter.
 */
function groupErrors(step: StepId, seen: LooseBlock, changes: ProposalChange[], groups: Item[]): string[] {
  const keeps = NON_FOCUS_KEEPS[step]
  if (!keeps) return []
  const after: Record<string, Item[]> = {}
  for (const [name, slot] of Object.entries(seen)) if (Array.isArray(slot)) after[name] = slot.map((i) => ({ ...i }))
  const touched: { n: number; collection: string; id: string }[] = []
  changes.forEach((c, i) => {
    const list = after[c.collection]
    if (!list) return
    const id = c.op === 'add' ? c.tempId! : c.targetId!
    if (c.op === 'remove') return void list.splice(list.findIndex((x) => x.id === id), 1)
    if (c.op === 'add') list.push({ id, rev: 1, editedByUser: false, ...c.fields } as Item)
    else Object.assign(list.find((x) => x.id === id) ?? {}, c.fields)
    touched.push({ n: i + 1, collection: c.collection, id })
  })
  const errors: string[] = []
  for (const { n, collection, id } of touched) {
    const list = after[collection]
    const item = list.find((x) => x.id === id)
    if (!item || typeof item.groupId !== 'string') continue
    const group = groups.find((g) => g.id === item.groupId)
    if (!group) {
      errors.push(`Änderung ${n}: groupId "${item.groupId}" ist keine Zielgruppe aus Schritt 1.`)
      continue
    }
    if (!group.isFocus && !keeps.includes(collection)) errors.push(`Änderung ${n}: „${group.name}“ ist keine Fokusgruppe; dafür gibt es hier nur ${keeps.join(', ')}.`)
    if (collection === 'problems' && list.filter((x) => x.groupId === item.groupId).length > 1) {
      errors.push(`Änderung ${n}: „${group.name}“ hat schon ein Kernproblem. Ändere das vorhandene (update), statt ein zweites anzulegen.`)
    }
    if (!TREES[step]?.includes(collection)) continue
    const parent = item.parentId as string
    if (parent) {
      const p = list.find((x) => x.id === parent)
      if (!p) errors.push(`Änderung ${n}: parentId "${parent}" gibt es in „${collection}“ nicht.`)
      else if (p.groupId !== item.groupId) errors.push(`Änderung ${n}: parentId "${parent}" gehört zu einer anderen Gruppe.`)
    }
    if (depthOf(list, item) + heightOf(list, item) > MAX_DEPTH) errors.push(`Änderung ${n}: höchstens ${MAX_DEPTH} Ebenen (direkt, darunter, darunter).`)
  }
  return errors
}

/** Fields where "" is a value, not a lazy blank: `parentId` "" = directly at the core problem (step 2). */
const MEANINGFUL_EMPTY = new Set(['parentId'])

const isEmpty = (value: unknown) => value === '' || (Array.isArray(value) && !value.length)

/**
 * Only the fields whose value differs from the seen item. An empty value never clears a
 * filled field: a lazily sent "" must not wipe what Lukas wrote (he can clear it himself).
 */
function changedFields(item: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => {
      const before = item[key] ?? ''
      if (isEmpty(value) && !isEmpty(before) && !MEANINGFUL_EMPTY.has(key)) return false
      return JSON.stringify(before) !== JSON.stringify(value)
    }),
  )
}

function tempIdsIn(value: unknown): string[] {
  if (typeof value === 'string') return TEMP_ID.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(tempIdsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(tempIdsIn)
  return []
}

const OP = { add: 'hinzufügen', update: 'ändern', remove: 'entfernen' } as const

/** What Lukas did with each change so far: the tool_result sent with his next message. */
export function proposalResultText(project: Project, step: StepId, proposal: Proposal): string {
  const lines = proposal.changes.map((change, i) => {
    const what = `${OP[change.op]} ${change.op === 'add' ? change.tempId : change.targetId} (${change.collection})`
    const view = changeView(project, step, proposal.id, change.id)
    const state = {
      applied: `übernommen${change.op === 'add' && change.resultId ? `, neue ID ${change.resultId}` : ''}`,
      rejected: 'abgelehnt',
      open: 'offen',
      blocked: 'offen',
      stale: 'veraltet',
    }[view.kind]
    return `${i + 1}. ${what}: ${state}`
  })
  return `Vorschlag ${proposal.id}:\n${lines.join('\n')}`
}

export function proposalToolResult(project: Project, step: StepId, proposal: Proposal): BetaToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: proposal.toolUseId, content: proposalResultText(project, step, proposal) }
}

export function errorToolResult(toolUseId: string, errors: string[]): BetaToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: `Vorschlag nicht angezeigt. Bitte korrigieren und neu vorschlagen:\n${errors.map((e) => `- ${e}`).join('\n')}`,
  }
}

/** A report_quality_check the app couldn't show. */
export function checkErrorToolResult(toolUseId: string, errors: string[]): BetaToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    is_error: true,
    content: `Qualitätscheck nicht angezeigt. Bitte korrigieren und neu melden:\n${errors.map((e) => `- ${e}`).join('\n')}`,
  }
}

/** The answer to report_quality_check. */
export function checkToolResult(toolUseId: string): BetaToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: toolUseId, content: 'Qualitätscheck wird der Person angezeigt.' }
}
