import { describe, expect, it } from 'vitest'
import { demoProject } from '../../../src/domain/demo'
import { FIXTURE_TIME, makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { collections, emptyBlock, itemSchema } from '../../../src/domain/schemas/blocks'
import { projectSchema, proposalChange, type Project } from '../../../src/domain/schemas/project'
import { stepIds } from '../../../src/domain/types'

const withBlock = (edit: (p: Project) => void) => {
  const p = structuredClone(makeProject({ steps: { 1: { block: { targetGroups: [makeItem(1, 'targetGroups', { name: 'Kinder' })] } } } }))
  edit(p)
  return projectSchema.safeParse(p)
}

describe('Schemas: valid documents', () => {
  it('accepts an empty project with all 7 steps', () => {
    const p = makeProject()
    expect(Object.keys(p.steps)).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(projectSchema.safeParse(p).success).toBe(true)
  })

  it('accepts the demo project (step 0 confirmed, with snapshot)', () => {
    const p = demoProject()
    expect(projectSchema.safeParse(p).success).toBe(true)
    expect(p.steps[0].status).toBe('confirmed')
    expect(p.steps[0].confirmed?.block.profile.name).toContain('Schraubzeit')
    expect(p.steps[1].status).toBe('not_started')
  })

  it('accepts a filled item in every collection of every step', () => {
    for (const step of stepIds) {
      const block = emptyBlock(step) as Record<string, unknown>
      for (const [name, meta] of Object.entries(collections[step])) {
        if (meta.singleton) continue
        // A source needs its time; every other field may start empty.
        block[name] = [makeItem(step, name as never, (name === 'sources' ? { at: FIXTURE_TIME } : {}) as never)]
      }
      const p = makeProject({ steps: { [step]: { block } } })
      expect(projectSchema.safeParse(p).success, `step ${step}`).toBe(true)
    }
  })

  it('every collection has an item schema and a unique id prefix', () => {
    const prefixes = stepIds.flatMap((s) => Object.entries(collections[s]).map(([name, meta]) => {
      expect(itemSchema(s, name), `${s}.${name}`).toBeDefined()
      return meta.prefix
    }))
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('makeProject hands out ids in list order and sets the counters', () => {
    const p = makeProject({
      steps: { 1: { block: { targetGroups: [makeItem(1, 'targetGroups'), makeItem(1, 'targetGroups', {}, { id: 'tg5' })] } } },
    })
    expect(p.steps[1].block.targetGroups.map((t) => t.id)).toEqual(['tg6', 'tg5'])
    expect(p.idCounters.tg).toBe(6)
  })
})

describe('Schemas: invalid documents are rejected', () => {
  it('an unknown field on an item', () => {
    expect(withBlock((p) => Object.assign(p.steps[1].block.targetGroups[0], { colour: 'rot' })).success).toBe(false)
  })

  it('a wrong enum value (evidence)', () => {
    const p = makeProject({ steps: { 2: { block: { causes: [makeItem(2, 'causes')] } } } })
    ;(p.steps[2].block.causes[0] as { evidence: string }).evidence = 'Bauchgefühl'
    expect(projectSchema.safeParse(p).success).toBe(false)
  })

  it('a goal on level 7 (goals are levels 4–6)', () => {
    const p = makeProject({ steps: { 3: { block: { goals: [makeItem(3, 'goals')] } } } })
    ;(p.steps[3].block.goals[0] as { level: number }).level = 7
    expect(projectSchema.safeParse(p).success).toBe(false)
  })

  it('a duplicate id', () => {
    expect(withBlock((p) => p.steps[1].block.targetGroups.push({ ...p.steps[1].block.targetGroups[0] })).success).toBe(false)
  })

  it('an id above its counter (would be handed out again)', () => {
    expect(withBlock((p) => (p.idCounters.tg = 0)).success).toBe(false)
  })

  it('an id with the wrong prefix', () => {
    expect(withBlock((p) => (p.steps[1].block.targetGroups[0].id = 'sh1')).success).toBe(false)
  })

  it('a singleton with another id', () => {
    expect(withBlock((p) => (p.steps[1].block.challenge.id = 'challenge2')).success).toBe(false)
  })

  it('rev 0, a newer schema version, an unknown status', () => {
    expect(withBlock((p) => (p.steps[1].block.targetGroups[0].rev = 0)).success).toBe(false)
    expect(withBlock((p) => ((p as { schemaVersion: number }).schemaVersion = 2)).success).toBe(false)
    expect(withBlock((p) => ((p.steps[1] as { status: string }).status = 'done')).success).toBe(false)
  })

  it('a missing collection in a block', () => {
    expect(withBlock((p) => delete (p.steps[1].block as Partial<typeof p.steps[1]['block']>).stakeholders).success).toBe(false)
  })
})

describe('Schemas: proposal changes', () => {
  const base = { id: 'c1', collection: 'targetGroups', state: 'open' as const }

  it('add needs a temp id and fields, and no target', () => {
    expect(proposalChange.safeParse({ ...base, op: 'add', tempId: 'new:1', fields: {} }).success).toBe(true)
    expect(proposalChange.safeParse({ ...base, op: 'add', fields: {} }).success).toBe(false)
    expect(proposalChange.safeParse({ ...base, op: 'add', tempId: 'tg1', fields: {} }).success).toBe(false)
    expect(proposalChange.safeParse({ ...base, op: 'add', tempId: 'new:1', targetId: 'tg1', fields: {} }).success).toBe(false)
  })

  it('update and remove need a target and the rev the assistant saw', () => {
    expect(proposalChange.safeParse({ ...base, op: 'update', targetId: 'tg1', baseRev: 2, fields: {} }).success).toBe(true)
    expect(proposalChange.safeParse({ ...base, op: 'update', targetId: 'tg1', fields: {} }).success).toBe(false)
    expect(proposalChange.safeParse({ ...base, op: 'remove', targetId: 'tg1', baseRev: 1 }).success).toBe(true)
    expect(proposalChange.safeParse({ ...base, op: 'remove', baseRev: 1 }).success).toBe(false)
  })

  it('an update to an item created in the same proposal needs no baseRev', () => {
    expect(proposalChange.safeParse({ ...base, op: 'update', targetId: 'new:1', fields: {} }).success).toBe(true)
  })

  it('a project with a stored proposal stays valid', () => {
    const proposal = makeProposal([{ op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: { name: 'Eltern' } }])
    expect(projectSchema.safeParse(makeProject({ steps: { 1: { proposals: [proposal] } } })).success).toBe(true)
  })
})
