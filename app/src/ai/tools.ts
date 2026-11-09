import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from '../domain/schemas/zod'
import { collections, itemBase, itemSchema } from '../domain/schemas/blocks'
import { stepGuide } from '../guide'
import type { StepId } from '../domain/types'

// The two tools of every step (tech design §6.3), generated from the block schemas.
// Strict mode allows at most 16 union-typed and 24 optional parameters per request, so the
// shape is flat: every field is required, optional texts are "" when empty, and an update
// carries the item's complete fields (the app diffs them against the snapshot it sent).
// The only union is the list of change variants.

export const PROPOSE = 'propose_changes'
export const CHECK = 'report_quality_check'

/** German names of the collections, for the tool descriptions. */
const labels: Record<string, string> = {
  profile: 'Projektprofil',
  frame: 'Messrahmen',
  sources: 'Quellen',
  challenge: 'Herausforderung',
  targetGroups: 'Zielgruppen',
  stakeholders: 'Beteiligte',
  problems: 'Kernprobleme',
  causes: 'Ursachen',
  consequences: 'Folgen',
  goals: 'Ziele',
  levelNotApplicable: 'Stufe nicht zutreffend',
  level7: 'Beitrag Stufe 7',
  resources: 'Ressourcen',
  activities: 'Aktivitäten',
  outputs: 'Leistungen',
  links: 'Verbindungen',
  externalFactors: 'Externe Faktoren',
  sideEffects: 'Nebenwirkungen',
  focusQuestions: 'Lernfragen',
  deferredCandidates: 'Zurückgestellte Kandidaten',
  indicators: 'Indikatoren',
  mandatoryFigures: 'Pflichtangaben',
  planRows: 'Planzeilen',
}

/** The fields a change supplies for one collection: no bookkeeping, nothing optional. */
export function toolFields(step: StepId, collection: string): z.ZodObject {
  const schema = itemSchema(step, collection)
  const meta = (collections[step] as Record<string, { why?: true }>)[collection]
  if (!schema || !meta) throw new Error(`Unknown collection ${step}/${collection}`)
  const shape: Record<string, z.ZodType> = {}
  for (const [key, type] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    if (key in itemBase) continue
    shape[key] = required(type, `${collection}.${key}`)
  }
  if (meta.why) shape.why = z.string().describe('Warum (Pflicht vor dem Bestätigen); "" wenn noch offen')
  return z.strictObject(shape)
}

function required(type: z.ZodType, path: string): z.ZodType {
  if (!(type instanceof z.ZodOptional)) return type
  const inner = type.unwrap() as z.ZodType
  // Every optional field in the blocks is a text; "" stands for "not given".
  if (!(inner instanceof z.ZodString)) throw new Error(`Optional non-text field ${path}`)
  return z.string().describe('"" wenn nicht angegeben')
}

/** Input schema of propose_changes for a step. Also validates what Claude sends. */
export function proposeInput(step: StepId) {
  const meta = collections[step] as Record<string, { singleton?: true; userOnly?: true }>
  // Lukas's own material (step 0 sources) is never proposed.
  const names = Object.keys(meta).filter((c) => !meta[c].userOnly)
  const lists = names.filter((c) => !meta[c].singleton)
  const variants: z.ZodType[] = names.map((c) => {
    const singleton = !lists.includes(c)
    return z
      .strictObject({
        op: singleton ? z.literal('update') : z.enum(['add', 'update']),
        collection: z.literal(c),
        id: singleton
          ? z.literal(c)
          : z.string().describe('add: vorläufige ID, im ganzen Vorschlag fortlaufend und eindeutig (new:1, new:2, new:3 …); update: ID aus dem Bausteinstand'),
        fields: toolFields(step, c),
      })
      .describe(labels[c] ?? c)
  })
  if (lists.length)
    variants.push(
      z
        .strictObject({ op: z.literal('remove'), collection: z.enum(lists as [string, ...string[]]), id: z.string() })
        .describe('Element entfernen'),
    )
  return z.strictObject({
    summary: z.string().describe('Ein Satz: was sich ändert und warum'),
    changes: z.array(z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]])),
  })
}

export type ProposeInput = {
  summary: string
  changes: Array<{ op: 'add' | 'update' | 'remove'; collection: string; id: string; fields?: Record<string, unknown> }>
}

/** Criterion ids ("1", "10a" …) from the rubric table of the step's guide file. */
export function rubricCriteria(step: StepId): { id: string; name: string }[] {
  const section = stepGuide(step).text.split(/^## \d+\. Rubrik\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  const rows = [...section.matchAll(/^\| *(\d+[a-z]?) *\| *([^|]+?) *\|/gm)]
  if (!rows.length) throw new Error(`No rubric in step ${step}`)
  return rows.map(([, id, name]) => ({ id, name }))
}

export function checkInput(step: StepId) {
  const ids = rubricCriteria(step).map((c) => c.id) as [string, ...string[]]
  return z.strictObject({
    results: z.array(
      z.strictObject({
        criterion: z.enum(ids),
        result: z.enum(['ok', 'warn']).describe('ok = ✓ erfüllt, warn = ⚠ offen'),
        note: z.string().describe('Ein Satz'),
      }),
    ),
  })
}

export type CheckInput = { results: { criterion: string; result: 'ok' | 'warn'; note: string }[] }

/** JSON Schema for the API: no $schema key, everything else as Zod writes it. */
export function jsonSchema(schema: z.ZodType): BetaTool['input_schema'] {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { unrepresentable: 'throw' }) as Record<string, unknown>
  return rest as BetaTool['input_schema']
}

/** Both tools of a step, in a fixed order (tools sit first in the cached prefix). */
export function stepTools(step: StepId): BetaTool[] {
  const criteria = rubricCriteria(step)
    .map((c) => `${c.id} ${c.name}`)
    .join(' · ')
  return [
    {
      name: PROPOSE,
      description:
        'Schlägt Änderungen am Baustein dieses Schritts vor. Der einzige Weg, den Baustein zu ändern. ' +
        'Die Person übernimmt oder lehnt jede Änderung selbst ab. ' +
        // Step 16 PO run: big proposals came as thinking → tool call with no text, so no question.
        'Ruf es erst auf, nachdem du in derselben Nachricht deinen Text geschrieben hast (was du vorschlägst, warum, und genau eine Frage): ' +
        'Der Aufruf beendet deine Nachricht, ohne diesen Text sieht die Person keine Frage.',
      input_schema: jsonSchema(proposeInput(step)),
      strict: true,
      eager_input_streaming: true,
    },
    {
      name: CHECK,
      description: `Meldet den Qualitätscheck gegen die Rubrik dieses Schritts. Kriterien: ${criteria}`,
      input_schema: jsonSchema(checkInput(step)),
      strict: true,
      eager_input_streaming: true,
    },
  ]
}
