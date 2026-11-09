// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { stepIds } from '../../../src/domain/types'
import { collections, emptyFields } from '../../../src/domain/schemas/blocks'
import { CHECK, PROPOSE, proposeInput, rubricCriteria, stepTools } from '../../../src/ai/tools'

// Offline strict-mode lint (implementation plan step 8). The live check is `npm run contract`.

const SUPPORTED = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf',
  'description', 'pattern', 'minItems',
])

type Node = Record<string, unknown>

function walk(node: Node, path: string, visit: (node: Node, path: string) => void) {
  visit(node, path)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties') for (const [k, v] of Object.entries(value as Node)) walk(v as Node, `${path}.${k}`, visit)
    else if (key === 'items') walk(value as Node, `${path}[]`, visit)
    else if (key === 'anyOf') (value as Node[]).forEach((v, i) => walk(v, `${path}|${i}`, visit))
  }
}

/** Counts as the API counts them: parameters not in `required`, parameters using anyOf or type arrays. */
function lint(schema: Node) {
  const problems: string[] = []
  let optional = 0
  let unions = 0
  walk(schema, '$', (node, path) => {
    for (const key of Object.keys(node)) if (!SUPPORTED.has(key)) problems.push(`${path}: unsupported "${key}"`)
    if ('anyOf' in node || Array.isArray(node.type)) unions++
    if (node.type === 'object') {
      if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`)
      const props = Object.keys((node.properties as Node) ?? {})
      const required = (node.required as string[]) ?? []
      for (const p of props) if (!required.includes(p)) (optional++, problems.push(`${path}.${p}: not required`))
    }
    if ('minItems' in node && ![0, 1].includes(node.minItems as number)) problems.push(`${path}: minItems > 1`)
  })
  return { problems, optional, unions }
}

describe('tool schemas', () => {
  for (const step of stepIds) {
    it(`step ${step}: both tools pass the strict-mode lint and stay inside the limits`, () => {
      const tools = stepTools(step)
      expect(tools.map((t) => t.name)).toEqual([PROPOSE, CHECK])
      let optional = 0
      let unions = 0
      for (const tool of tools) {
        expect(tool.strict).toBe(true)
        expect(tool.eager_input_streaming).toBe(true)
        const result = lint(tool.input_schema as Node)
        expect(result.problems).toEqual([])
        optional += result.optional
        unions += result.unions
      }
      // Per request (API limits): 24 optional, 16 union-typed parameters.
      expect(optional).toBe(0)
      expect(unions).toBeLessThanOrEqual(16)
    })
  }

  it('has one change variant per collection Claude may change, plus remove when the step has lists', () => {
    for (const step of stepIds) {
      const schema = stepTools(step)[0].input_schema as Node
      const variants = ((schema.properties as Node).changes as Node).items as Node
      const metas = Object.values(collections[step]) as { singleton?: true; userOnly?: true }[]
      const open = metas.filter((m) => !m.userOnly)
      const lists = open.some((m) => !m.singleton) ? 1 : 0
      expect((variants.anyOf as Node[]).length).toBe(open.length + lists)
    }
  })

  it('step 0: profile and frame only — sources are Lukas\'s own and never proposed', () => {
    const schema = proposeInput(0)
    const profile = { op: 'update', collection: 'profile', id: 'profile', fields: { ...emptyFields(0, 'profile'), budgetRange: '', location: 'offen' } }
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [profile] }).success).toBe(true)
    const source = { op: 'add', collection: 'sources', id: 'new:1', fields: { origin: 'paste', label: 'x', text: 'y', at: '2026-11-08T10:00:00.000Z' } }
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [source] }).success).toBe(false)
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [{ op: 'remove', collection: 'sources', id: 'src1' }] }).success).toBe(false)
  })

  it('accepts a complete add and rejects missing or extra fields', () => {
    const fields = { ...emptyFields(1, 'targetGroups'), sizeEstimate: '', name: 'Jugendliche', why: '' }
    const schema = proposeInput(1)
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields }] }).success).toBe(true)
    const { why: _, ...noWhy } = fields
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: noWhy }] }).success).toBe(false)
    expect(
      schema.safeParse({ summary: 's', question: 'q?', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: { ...fields, rev: 3 } }] }).success,
    ).toBe(false)
    // Singletons can only be updated, under their own id.
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [{ op: 'add', collection: 'challenge', id: 'new:1', fields: { text: '', why: '' } }] }).success).toBe(false)
    expect(schema.safeParse({ summary: 's', question: 'q?', changes: [{ op: 'remove', collection: 'challenge', id: 'challenge' }] }).success).toBe(false)
  })

  it('the one question is a required text in every step (step 18b): strict mode always sends it', () => {
    for (const step of stepIds) {
      const schema = stepTools(step)[0].input_schema as Node
      expect((schema.properties as Node).question).toMatchObject({ type: 'string' })
      expect(schema.required).toContain('question')
    }
    const fields = { ...emptyFields(1, 'targetGroups'), sizeEstimate: '', name: 'Jugendliche', why: '' }
    const changes = [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields }]
    expect(proposeInput(1).safeParse({ summary: 's', changes }).success).toBe(false)
    expect(proposeInput(1).safeParse({ summary: 's', question: 'Passt das?', changes }).success).toBe(true)
  })

  it('reads the rubric criteria from the guide', () => {
    expect(rubricCriteria(1).map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(rubricCriteria(5).map((c) => c.id)).toContain('10a')
    expect(rubricCriteria(1)[0].name).toBe('Herausforderung als Zustand')
    for (const step of stepIds) expect(rubricCriteria(step).length).toBeGreaterThan(5)
  })
})
