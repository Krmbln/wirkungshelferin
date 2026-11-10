import { collectionMeta, emptyFields, itemSchema, type Item } from './schemas/blocks'
import { ID, type Project } from './schemas/project'
import type { StepId, StepStatus } from './types'

// Untyped access to a block by collection name, shared by the reducer and proposals.
// Callers check the collection with collectionMeta() first.

export type LooseBlock = Record<string, Item | Item[]>
export type LooseStep = Omit<Project['steps'][StepId], 'block'> & { block: LooseBlock }

export const stepOf = (project: Project, step: StepId) => project.steps[step] as unknown as LooseStep

/** Where an item lives: its list and index, or the singleton slot (index -1). */
export function findItem(block: LooseBlock, collection: string, id: string): { item: Item; index: number } | undefined {
  const slot = block[collection]
  if (Array.isArray(slot)) {
    const index = slot.findIndex((i) => i.id === id)
    return index === -1 ? undefined : { item: slot[index], index }
  }
  return slot && slot.id === id ? { item: slot, index: -1 } : undefined
}

export function putItem(block: LooseBlock, collection: string, item: Item, index: number): void {
  const slot = block[collection]
  if (Array.isArray(slot)) slot[index] = item
  else block[collection] = item
}

/** Hands out the next id for a prefix and advances the counter (ids are never reused). */
export function nextId(project: Project, prefix: string): string {
  const n = (project.idCounters[prefix] ?? 0) + 1
  project.idCounters[prefix] = n
  return `${prefix}${n}`
}

/** True if the id was handed out for this collection at some point (so it is now deleted). */
export function existedBefore(project: Project, step: StepId, collection: string, id: string): boolean {
  const meta = collectionMeta(step, collection)
  const match = id.match(ID)
  return !!meta && !!match && match[1] === meta.prefix && Number(match[2]) <= (project.idCounters[meta.prefix] ?? 0)
}

/** The item if it matches its collection's schema, else null. */
export function validItem(step: StepId, collection: string, item: Record<string, unknown>): Item | null {
  const result = itemSchema(step, collection)?.safeParse(item)
  return result?.success ? (result.data as Item) : null
}

export function newItem(step: StepId, collection: string, id: string, fields: Record<string, unknown>, editedByUser: boolean) {
  return validItem(step, collection, { ...emptyFields(step, collection), ...fields, id, rev: 1, editedByUser })
}

/**
 * Where an item sits, not what it says: a row added by hand under a group, a parent or at a level
 * (steps 2–4), or under a question (step 5 indicators) gets these at once, and is still empty
 * (step 17; step 16's rows never went again).
 */
const PLACEMENT = new Set(['groupId', 'parentId', 'level', 'focusQuestionId'])

/** True if no field holds anything beyond its empty value (the Why included); placement doesn't count. */
export function isEmptyItem(step: StepId, collection: string, item: Item): boolean {
  const empty = emptyFields(step, collection)
  return Object.entries(item).every(([key, value]) => {
    if (key === 'id' || key === 'rev' || key === 'editedByUser' || PLACEMENT.has(key)) return true
    if (key in empty) return JSON.stringify(value) === JSON.stringify(empty[key])
    return value === undefined || value === ''
  })
}

/** A change to the block moves a fresh or confirmed step to "in Arbeit" (PRD F6: reopening). */
/** A confirmed version stands: confirmed, or confirmed and "vielleicht veraltet" since (step 21). */
export const isConfirmed = (status: StepStatus) => status === 'confirmed' || status === 'maybe_outdated'

export function touched(status: StepStatus): StepStatus {
  return status === 'not_started' || status === 'confirmed' ? 'in_progress' : status
}
