import { ID, SCHEMA_VERSION, projectSchema, type Project, type Proposal, type ProposalChange, type StepState } from './schemas/project'
import { collections, emptyBlock, emptyFields, type Block, type CollectionName, type FieldsOf, type ItemOf } from './schemas/blocks'
import { stepIds, type StepId, type StepStatus } from './types'

// Typed builders for tests, the gallery and the demo project (made-up content only).

export const FIXTURE_TIME = '2026-11-02T10:00:00.000Z'

type Meta = { id?: string; rev?: number; editedByUser?: boolean }

/**
 * One item of a collection. Missing fields start empty; a missing id is handed out by
 * makeProject in list order (tg1, tg2 …).
 */
export function makeItem<S extends StepId, C extends CollectionName<S>>(
  step: S,
  collection: C,
  fields: Partial<FieldsOf<S, C>> = {},
  meta: Meta = {},
): ItemOf<S, C> {
  return {
    ...emptyFields(step, collection),
    ...fields,
    id: meta.id ?? (collections[step][collection].singleton ? collection : ''),
    rev: meta.rev ?? 1,
    editedByUser: meta.editedByUser ?? false,
  } as ItemOf<S, C>
}

export type StepInit<S extends StepId> = {
  status?: StepStatus
  block?: Partial<Block<S>>
  proposals?: Proposal[]
  confirmedAt?: string
}

export function makeStep<S extends StepId>(step: S, init: StepInit<S> = {}): StepState<S> {
  const block = { ...emptyBlock(step), ...init.block } as Block<S>
  const status = init.status ?? 'not_started'
  // Generic S can't be narrowed by TS here; makeProject validates the result with Zod.
  return {
    status,
    block,
    segments: [],
    proposals: init.proposals ?? [],
    confirmedWarnings: [],
    ...(status === 'confirmed' && {
      confirmed: { at: init.confirmedAt ?? FIXTURE_TIME, block: structuredClone(block), basis: {} },
    }),
  } as StepState<S>
}

export type ProjectInit = { steps?: { [S in StepId]?: StepInit<S> }; at?: string; privacyNoteSeen?: boolean }

/** A valid project: ids handed out where missing, counters set to the highest id in use. */
export function makeProject(init: ProjectInit = {}): Project {
  const at = init.at ?? FIXTURE_TIME
  const steps = Object.fromEntries(stepIds.map((s) => [s, makeStep(s, (init.steps?.[s] ?? {}) as StepInit<typeof s>)]))
  const project = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    privacyNoteSeen: init.privacyNoteSeen ?? true,
    steps,
    idCounters: {} as Record<string, number>,
  } as Project

  // Counters first from explicit ids, then hand out the missing ones.
  const lists = stepIds.flatMap((s) =>
    Object.entries(collections[s])
      .filter(([, meta]) => !meta.singleton)
      .map(([name, meta]) => ({ prefix: meta.prefix, items: (project.steps[s].block as Record<string, { id: string }[]>)[name] })),
  )
  for (const { prefix, items } of lists) {
    for (const { id } of items) {
      const n = Number(id.match(ID)?.[2] ?? 0)
      project.idCounters[prefix] = Math.max(project.idCounters[prefix] ?? 0, n)
    }
  }
  for (const { prefix, items } of lists) {
    for (const item of items) {
      if (item.id) continue
      const n = (project.idCounters[prefix] ?? 0) + 1
      project.idCounters[prefix] = n
      item.id = `${prefix}${n}`
    }
  }
  // Snapshots of confirmed steps are taken after the ids exist.
  for (const s of stepIds) {
    const state = project.steps[s]
    if (state.confirmed) state.confirmed.block = structuredClone(state.block) as typeof state.confirmed.block
  }
  return projectSchema.parse(project)
}

type ChangeInit = Omit<ProposalChange, 'id' | 'state'> & { id?: string; state?: ProposalChange['state'] }

/** A proposal with ids c1, c2 … and all changes open unless stated. */
export function makeProposal(changes: ChangeInit[], meta: { id?: string; summary?: string; at?: string } = {}): Proposal {
  const id = meta.id ?? 'p1'
  return {
    id,
    toolUseId: `toolu_${id}`,
    at: meta.at ?? FIXTURE_TIME,
    summary: meta.summary ?? 'Vorschlag',
    changes: changes.map((c, i) => ({ ...c, id: c.id ?? `${id}c${i + 1}`, state: c.state ?? 'open' })),
  }
}
