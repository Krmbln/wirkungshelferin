import { z } from './zod'
import { stepIds, stepStatuses, type StepId } from '../types'
import { blockSchemas, collections, type Block } from './blocks'

// One JSON document per project (tech design §7). Schema version stays 1 until step 24.
export const SCHEMA_VERSION = 1

const iso = z.iso.datetime()

export const TEMP_ID = /^new:\d+$/
export const ID = /^([a-z]+)(\d+)$/

/**
 * Raw API content blocks (text, thinking, tool_use, tool_result), stored unchanged: the
 * history is append-only (tech design §6.2). `system` = app events. `aborted` = a stopped
 * turn: shown, never sent again. The other fields are local metadata, never sent.
 */
export const storedMessage = z.strictObject({
  id: z.string(),
  at: iso,
  role: z.enum(['user', 'assistant', 'system']),
  content: z.array(z.record(z.string(), z.unknown())),
  aborted: z.literal(true).optional(),
  /** Invalid tool calls of this assistant turn (tool_use id → errors), answered as error results next turn. */
  toolErrors: z.record(z.string(), z.array(z.string())).optional(),
  /** Tokens of a complete answer: the whole prompt it read and its output. Decides when a segment rolls over. */
  usage: z.strictObject({ prompt: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).optional(),
})

export type StoredMessage = z.infer<typeof storedMessage>

const chatSegment = z.strictObject({
  id: z.string(),
  startedAt: iso,
  /** The model the segment talks to; a different model in the settings starts a new segment. Missing = from before step 10. */
  model: z.string().optional(),
  summaryOfPrevious: z.string().optional(),
  messages: z.array(storedMessage),
})

export type ChatSegment = z.infer<typeof chatSegment>

/**
 * The assistant's rubric judgement (✓/⚠ per criterion) and the block it judged. The ⛔ rows are
 * not stored: they are derived from that block (domain/check.ts), so they can't drift.
 * `source`: the gate's "Prüfen" (app) or a check Claude reported on its own in the chat.
 */
function qualityCheck<B extends z.ZodType>(block: B) {
  return z.strictObject({
    at: iso,
    source: z.enum(['app', 'chat']),
    block,
    results: z.array(z.strictObject({ criterion: z.string(), result: z.enum(['ok', 'warn']), note: z.string() })),
  })
}

// "veraltet" is not stored: it is derived from the block (proposals.ts), so it can't drift.
export const proposalChange = z
  .strictObject({
    id: z.string(),
    op: z.enum(['add', 'update', 'remove']),
    collection: z.string(),
    tempId: z.string().regex(TEMP_ID).optional(),
    targetId: z.string().optional(),
    /** The rev the assistant saw, from the block snapshot sent with the request. */
    baseRev: z.number().int().min(1).optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    state: z.enum(['open', 'applied', 'rejected']),
    /** add: the real id the temp id resolved to. */
    resultId: z.string().optional(),
    /** Set while applied, for "Rückgängig". */
    undo: z
      .strictObject({
        before: z.record(z.string(), z.unknown()).nullable(),
        index: z.number().int().min(0),
        afterRev: z.number().int().min(1),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (c.op === 'add') {
      if (!c.tempId) fail('add needs a tempId')
      if (!c.fields) fail('add needs fields')
      if (c.targetId) fail('add has no targetId')
    } else {
      if (!c.targetId) fail(`${c.op} needs a targetId`)
      // A change to an item created in the same proposal has no rev to have seen.
      if (c.baseRev === undefined && !(c.targetId && TEMP_ID.test(c.targetId))) fail(`${c.op} needs a baseRev`)
      if (c.op === 'update' && !c.fields) fail('update needs fields')
    }
  })

export const proposal = z.strictObject({
  id: z.string(),
  toolUseId: z.string(),
  at: iso,
  summary: z.string(),
  changes: z.array(proposalChange),
})

const stepKey = z.enum(['0', '1', '2', '3', '4', '5', '6'])

function stepState<B extends z.ZodType>(block: B) {
  return z.strictObject({
    status: z.enum(stepStatuses),
    block,
    segments: z.array(chatSegment),
    proposals: z.array(proposal),
    qualityCheck: qualityCheck(block).optional(),
    confirmedWarnings: z.array(z.string()),
    confirmed: z
      .strictObject({ at: iso, block, basis: z.partialRecord(stepKey, iso) })
      .optional(),
    resume: z.strictObject({ summary: z.string(), nextAction: z.string(), at: iso }).optional(),
    /** The block as the newest stored user turn showed it: base for "unverändert" and for baseRev. */
    sentBlock: block.optional(),
  })
}

export const projectSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    createdAt: iso,
    updatedAt: iso,
    lastBackupAt: iso.optional(),
    lastActive: z.strictObject({ stepId: z.literal([...stepIds]), at: iso }).optional(),
    privacyNoteSeen: z.boolean(),
    steps: z.strictObject({
      0: stepState(blockSchemas[0]),
      1: stepState(blockSchemas[1]),
      2: stepState(blockSchemas[2]),
      3: stepState(blockSchemas[3]),
      4: stepState(blockSchemas[4]),
      5: stepState(blockSchemas[5]),
      6: stepState(blockSchemas[6]),
    }),
    /** Highest number handed out per prefix. Never decreases, so ids are never reused. */
    idCounters: z.record(z.string(), z.number().int().min(0)),
  })
  .superRefine((project, ctx) => {
    const seen = new Set<string>()
    for (const step of stepIds) {
      const block = project.steps[step].block as Record<string, unknown>
      for (const [name, meta] of Object.entries(collections[step])) {
        const path = ['steps', step, 'block', name]
        if (meta.singleton) {
          const item = block[name] as { id: string }
          if (item.id !== name) ctx.addIssue({ code: 'custom', path, message: `singleton id must be "${name}"` })
          continue
        }
        for (const item of block[name] as { id: string }[]) {
          const match = item.id.match(ID)
          if (!match || match[1] !== meta.prefix) {
            ctx.addIssue({ code: 'custom', path, message: `id ${item.id} needs prefix "${meta.prefix}"` })
          } else if (Number(match[2]) > (project.idCounters[meta.prefix] ?? 0)) {
            ctx.addIssue({ code: 'custom', path, message: `id ${item.id} is above its counter` })
          }
          if (seen.has(item.id)) ctx.addIssue({ code: 'custom', path, message: `duplicate id ${item.id}` })
          seen.add(item.id)
        }
      }
    }
  })

export type Project = z.infer<typeof projectSchema>
export type StepState<S extends StepId = StepId> = Omit<Project['steps'][S], 'block'> & { block: Block<S> }
export type Proposal = z.infer<typeof proposal>
export type ProposalChange = z.infer<typeof proposalChange>
/** A step's quality check with its block untyped (any step). */
export type QualityCheck = Omit<NonNullable<Project['steps'][StepId]['qualityCheck']>, 'block'> & { block: Record<string, unknown> }
