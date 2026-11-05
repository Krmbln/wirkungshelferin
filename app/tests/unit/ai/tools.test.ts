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

  it('has one change variant per collection plus remove', () => {
    for (const step of stepIds) {
      const schema = stepTools(step)[0].input_schema as Node
      const variants = ((schema.properties as Node).changes as Node).items as Node
      expect((variants.anyOf as Node[]).length).toBe(Object.keys(collections[step]).length + 1)
    }
  })

  it('accepts a complete add and rejects missing or extra fields', () => {
    const fields = { ...emptyFields(1, 'targetGroups'), sizeEstimate: '', name: 'Jugendliche', why: '' }
    const schema = proposeInput(1)
    expect(schema.safeParse({ summary: 's', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields }] }).success).toBe(true)
    const { why: _, ...noWhy } = fields
    expect(schema.safeParse({ summary: 's', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: noWhy }] }).success).toBe(false)
    expect(
      schema.safeParse({ summary: 's', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: { ...fields, rev: 3 } }] }).success,
    ).toBe(false)
    // Singletons can only be updated, under their own id.
    expect(schema.safeParse({ summary: 's', changes: [{ op: 'add', collection: 'challenge', id: 'new:1', fields: { text: '', why: '' } }] }).success).toBe(false)
    expect(schema.safeParse({ summary: 's', changes: [{ op: 'remove', collection: 'challenge', id: 'challenge' }] }).success).toBe(false)
  })

  it('reads the rubric criteria from the guide', () => {
    expect(rubricCriteria(1).map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(rubricCriteria(5).map((c) => c.id)).toContain('10a')
    expect(rubricCriteria(1)[0].name).toBe('Herausforderung als Zustand')
    for (const step of stepIds) expect(rubricCriteria(step).length).toBeGreaterThan(5)
  })
})
