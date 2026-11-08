import { confirmStep } from './check'
import { findItem, isEmptyItem, newItem, nextId, putItem, stepOf, touched, validItem } from './block'
import { deleteTargetGroup } from './groups'
import { applyAll, applyChange, rejectChange, undoChange } from './proposals'
import { collectionMeta, type Item } from './schemas/blocks'
import type { Project, Proposal, QualityCheck } from './schemas/project'
import type { StepId } from './types'

// The one way state changes (tech design §4). Pure: no time, no I/O. An action that
// doesn't fit (unknown collection, invalid fields, missing item) leaves the project as is.

type Target = { step: StepId; collection: string }
type ChangeRef = { step: StepId; proposalId: string; changeId: string }

export type Action =
  /** Lukas adds an item ("+ hinzufügen"); missing fields start empty. */
  | ({ type: 'item/add'; fields?: Record<string, unknown> } & Target)
  /** Lukas edits an item inline: rev rises, the item counts as edited by him. */
  | ({ type: 'item/edit'; id: string; fields: Record<string, unknown> } & Target)
  | ({ type: 'item/remove'; id: string } & Target)
  /** A row Lukas just added and left empty goes again; one with any content stays. */
  | ({ type: 'item/discard'; id: string } & Target)
  /** The 10-second "Rückgängig" after a removal (design §7.6). */
  | ({ type: 'item/restore'; item: Item; index: number } & Target)
  | { type: 'proposal/add'; step: StepId; proposal: Proposal }
  | ({ type: 'change/apply' } & ChangeRef)
  | ({ type: 'change/reject' } & ChangeRef)
  | ({ type: 'change/undo' } & ChangeRef)
  | { type: 'change/applyAll'; step: StepId; proposalId: string }
  /** Removes a target group with its step 2–4 items (after the confirm dialog, PRD F5). */
  | { type: 'targetGroup/delete'; id: string }
  /** The newest quality check of a step (the gate's "Prüfen", or one Claude reported in the chat). */
  | { type: 'check/store'; step: StepId; check: QualityCheck }
  /** "Bestätigen": refused while the check is missing or old, or a ⛔ is open (PRD F4). */
  | { type: 'step/confirm'; step: StepId; at: string }

export function reducer(project: Project, action: Action): Project {
  switch (action.type) {
    case 'check/store': {
      // A gate check and a chat turn can finish in either order: the newer result wins.
      const old = project.steps[action.step].qualityCheck
      if (old && old.at > action.check.at) return project
      const next = structuredClone(project)
      next.steps[action.step].qualityCheck = structuredClone(action.check) as never
      return next
    }
    case 'step/confirm':
      return confirmStep(project, action.step, action.at)
    case 'targetGroup/delete':
      return deleteTargetGroup(project, action.id)
    case 'change/apply':
      return applyChange(project, action.step, action.proposalId, action.changeId)
    case 'change/reject':
      return rejectChange(project, action.step, action.proposalId, action.changeId)
    case 'change/undo':
      return undoChange(project, action.step, action.proposalId, action.changeId)
    case 'change/applyAll':
      return applyAll(project, action.step, action.proposalId)
    case 'proposal/add': {
      const next = structuredClone(project)
      next.steps[action.step].proposals.push(action.proposal)
      return next
    }
    default:
      return editBlock(project, action)
  }
}

type ItemAction = Extract<Action, { type: `item/${string}` }>

function editBlock(project: Project, action: ItemAction): Project {
  const meta = collectionMeta(action.step, action.collection)
  if (!meta) return project
  if (meta.singleton && action.type !== 'item/edit') return project

  const next = structuredClone(project)
  const state = stepOf(next, action.step)
  const block = state.block

  switch (action.type) {
    case 'item/add': {
      const item = newItem(action.step, action.collection, nextId(next, meta.prefix), action.fields ?? {}, true)
      if (!item) return project
      ;(block[action.collection] as Item[]).push(item)
      break
    }
    case 'item/edit': {
      const found = findItem(block, action.collection, action.id)
      if (!found || 'id' in action.fields || 'rev' in action.fields) return project
      const item = validItem(action.step, action.collection, {
        ...found.item,
        ...action.fields,
        rev: found.item.rev + 1,
        editedByUser: true,
      })
      if (!item) return project
      putItem(block, action.collection, item, found.index)
      break
    }
    case 'item/discard':
    case 'item/remove': {
      const found = findItem(block, action.collection, action.id)
      if (!found) return project
      if (action.type === 'item/discard' && !isEmptyItem(action.step, action.collection, found.item)) return project
      ;(block[action.collection] as Item[]).splice(found.index, 1)
      break
    }
    case 'item/restore': {
      const list = block[action.collection] as Item[]
      if (list.some((i) => i.id === action.item.id) || !validItem(action.step, action.collection, action.item)) return project
      list.splice(Math.min(action.index, list.length), 0, action.item)
      break
    }
  }
  state.status = touched(state.status)
  return next
}
