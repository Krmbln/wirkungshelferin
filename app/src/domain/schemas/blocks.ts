import { z } from './zod'
import { evidenceLabels, type StepId } from '../types'

// The seven blocks (tech design §7.1, fields from PRD F5).
// Every list entry and every singleton is an Item: a stable id, a rev counter that rises on
// every change, and editedByUser. The id is the short ID itself ("tg3"), never reused.

export const itemBase = {
  id: z.string().min(1),
  rev: z.number().int().min(1),
  editedByUser: z.boolean(),
  why: z.string().optional(),
}

const text = z.string()
const texts = z.array(z.string())
const ref = z.string()
const refs = z.array(z.string())
const evidence = z.enum(evidenceLabels)

/** A singleton: exactly one item, its id is the collection name. */
const one = <S extends z.ZodRawShape>(shape: S) => z.strictObject({ ...itemBase, ...shape })
/** A list of items. */
const many = <S extends z.ZodRawShape>(shape: S) => z.array(z.strictObject({ ...itemBase, ...shape }))

// "offen" marks unknown fields in step 0; it is a value, never a guess (PRD F3).
const step0 = z.strictObject({
  profile: one({
    name: text,
    organisation: text,
    projectBoundary: text,
    location: text,
    participants: text,
    funder: text,
    activities: texts,
    duration: text,
    budgetRange: text.optional(),
    statedGoals: texts,
    otherOffers: texts,
    openQuestions: texts,
  }),
  frame: one({
    purpose: z.enum(['offen', 'geldgeberin', 'lernen', 'beides']),
    audience: text,
    requiredFormat: text.optional(),
    existingData: texts,
  }),
  sources: many({ origin: z.enum(['paste', 'pdf', 'interview']), label: text, text }),
})

const step1 = z.strictObject({
  challenge: one({ text }),
  targetGroups: many({
    name: text,
    description: text,
    reach: z.enum(['direct', 'indirect']),
    isFocus: z.boolean(),
    sizeEstimate: text.optional(),
  }),
  stakeholders: many({ role: text, expectations: texts }),
})

const step2 = z.strictObject({
  problems: many({ groupId: ref, coreProblem: text }),
  causes: many({ groupId: ref, text, evidence, notInfluenceable: z.boolean() }),
  consequences: many({ groupId: ref, text }),
})

const step3 = z.strictObject({
  goals: many({ groupId: ref, level: z.literal([4, 5, 6]), text, causeIds: refs, timeFrame: text }),
  levelNotApplicable: many({ groupId: ref, level: z.literal([4, 5, 6]) }),
  level7: one({ text }),
})

const step4 = z.strictObject({
  resources: many({ text }),
  activities: many({ text }),
  outputs: many({ groupId: ref, level: z.literal([1, 2, 3]), text }),
  links: many({
    groupId: ref,
    fromId: ref,
    toId: ref,
    because: text,
    assumption: text,
    evidence,
    critical: z.boolean(),
  }),
  externalFactors: many({ groupId: ref.optional(), text }),
  sideEffects: many({ text, affectedGroup: text, direction: z.enum(['negative', 'positive']) }),
})

const step5 = z.strictObject({
  focusQuestions: many({
    text,
    reason: z.enum(['geldgeberin', 'eigenes_lernen', 'kritische_annahme']),
    audience: text,
    linkIds: refs,
    goalIds: refs,
  }),
  deferredCandidates: many({ linkId: ref, reason: text }),
  indicators: many({
    text,
    level: z.literal([1, 2, 3, 4, 5, 6, 7]),
    focusQuestionId: ref,
    baseline: text,
    baselinePlan: text.optional(),
    target: text,
    rubricNote: text.optional(),
  }),
  mandatoryFigures: many({ name: text, target: text, unit: text.optional(), sourceNote: text.optional() }),
})

const step6 = z.strictObject({
  planRows: many({
    indicatorIds: refs,
    mandatoryFigureIds: refs,
    dataSource: text,
    method: text,
    collector: text,
    frequency: text,
    consentNote: text,
    analysis: text,
    firstCollection: text,
  }),
})

export const blockSchemas = { 0: step0, 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6 } as const

export type Block<S extends StepId> = z.infer<(typeof blockSchemas)[S]>
export type CollectionName<S extends StepId> = keyof Block<S> & string
type Entry<T> = T extends readonly (infer I)[] ? I : T
export type ItemOf<S extends StepId, C extends CollectionName<S>> = Entry<Block<S>[C]>
/** What a builder or a proposal supplies: the item without its bookkeeping. */
export type FieldsOf<S extends StepId, C extends CollectionName<S>> = Omit<ItemOf<S, C>, 'id' | 'rev' | 'editedByUser'>

export type Item = { id: string; rev: number; editedByUser: boolean; why?: string } & Record<string, unknown>

type CollectionMeta = { prefix: string; singleton?: true; why?: true }

// Per collection: id prefix (or singleton) and whether it carries a "Why" (PRD F5 *).
// Prefixes are unique across all steps, so an id is unique in the whole project.
export const collections: { [S in StepId]: Record<CollectionName<S>, CollectionMeta> } = {
  0: { profile: { prefix: 'profile', singleton: true }, frame: { prefix: 'frame', singleton: true }, sources: { prefix: 'src' } },
  1: {
    challenge: { prefix: 'challenge', singleton: true, why: true },
    targetGroups: { prefix: 'tg', why: true },
    stakeholders: { prefix: 'sh' },
  },
  2: { problems: { prefix: 'pb', why: true }, causes: { prefix: 'ca', why: true }, consequences: { prefix: 'co' } },
  3: {
    goals: { prefix: 'go', why: true },
    levelNotApplicable: { prefix: 'na', why: true },
    level7: { prefix: 'level7', singleton: true, why: true },
  },
  4: {
    resources: { prefix: 'rs' },
    activities: { prefix: 'ac', why: true },
    outputs: { prefix: 'ou' },
    // The "because" mechanism counts as the link's Why (PRD F5).
    links: { prefix: 'li' },
    externalFactors: { prefix: 'ef' },
    sideEffects: { prefix: 'se' },
  },
  5: {
    focusQuestions: { prefix: 'fq', why: true },
    deferredCandidates: { prefix: 'dc' },
    indicators: { prefix: 'in', why: true },
    mandatoryFigures: { prefix: 'mf' },
  },
  6: { planRows: { prefix: 'pr', why: true } },
}

export function collectionMeta(step: StepId, collection: string): CollectionMeta | undefined {
  return (collections[step] as Record<string, CollectionMeta>)[collection]
}

/** The Zod schema of one item of a collection, or undefined for an unknown collection. */
export function itemSchema(step: StepId, collection: string): z.ZodObject | undefined {
  const field = (blockSchemas[step].shape as Record<string, z.ZodType>)[collection]
  if (!field) return undefined
  return (field instanceof z.ZodArray ? field.element : field) as z.ZodObject
}

/** Empty values for a new item: '' / false / [] / the first option; optional fields left out. */
export function emptyFields(step: StepId, collection: string): Record<string, unknown> {
  const schema = itemSchema(step, collection)
  if (!schema) return {}
  const fields: Record<string, unknown> = {}
  for (const [key, type] of Object.entries(schema.shape)) {
    if (key in itemBase) continue
    const value = emptyOf(type as z.ZodType)
    if (value !== undefined) fields[key] = value
  }
  return fields
}

function emptyOf(type: z.ZodType): unknown {
  if (type instanceof z.ZodOptional) return undefined
  if (type instanceof z.ZodString) return ''
  if (type instanceof z.ZodBoolean) return false
  if (type instanceof z.ZodArray) return []
  if (type instanceof z.ZodEnum) return type.options[0]
  if (type instanceof z.ZodLiteral) return [...type.values][0]
  throw new Error(`No empty value for ${type.constructor.name}`)
}

export function emptyBlock<S extends StepId>(step: S): Block<S> {
  const block: Record<string, unknown> = {}
  for (const [name, meta] of Object.entries(collections[step]) as [string, CollectionMeta][]) {
    block[name] = meta.singleton ? { id: name, rev: 1, editedByUser: false, ...emptyFields(step, name) } : []
  }
  return block as Block<S>
}
