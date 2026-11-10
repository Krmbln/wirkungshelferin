import { confirmStep } from '../src/domain/check'
import { makeItem, makeProject } from '../src/domain/fixtures'
import { reducer, type Action } from '../src/domain/reducer'
import { projectSchema, type Project } from '../src/domain/schemas/project'
import type { StepId, StepStatus } from '../src/domain/types'

// Change handling fixtures (step 21): steps 0–6 confirmed, step 2 re-confirmable. Made-up content.

export const FIRST = '2026-11-03T10:00:00.000Z'
export const AT = '2026-11-10T10:00:00.000Z'
export const LATER = '2026-11-10T12:00:00.000Z'

const group = (id: string) => makeItem(1, 'targetGroups', { name: `Gruppe ${id}`, isFocus: true, why: 'weil' }, { id })

/** Steps 0–6 with the given statuses; step 2 holds a valid block, so it can be re-confirmed. */
export function outdatedProject(statuses: Partial<Record<StepId, StepStatus>> = {}): Project {
  const s = { 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'confirmed', 4: 'confirmed', 5: 'confirmed', 6: 'confirmed', ...statuses } as Record<StepId, StepStatus>
  const p = makeProject({
    steps: {
      0: { status: s[0], confirmedAt: FIRST, block: { profile: makeItem(0, 'profile', { name: 'Schraubzeit', location: 'Nordstadt' }) } },
      1: { status: s[1], confirmedAt: FIRST, block: { challenge: makeItem(1, 'challenge', { text: 'Zu wenig Orte', why: 'Daran hängt alles.' }), targetGroups: [group('tg1')] } },
      2: {
        status: s[2],
        confirmedAt: FIRST,
        block: {
          problems: [makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Räder kaputt', why: 'sieht man' }, { id: 'pb1' })],
          causes: [makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Kein Werkzeug', why: 'beobachtet' }, { id: 'ca1' })],
        },
      },
      3: { status: s[3], confirmedAt: FIRST },
      4: { status: s[4], confirmedAt: FIRST },
      5: { status: s[5], confirmedAt: FIRST },
      6: { status: s[6], confirmedAt: FIRST },
    },
  })
  // A step "in Arbeit" or outdated was confirmed once: it keeps its snapshot.
  for (const step of [3, 4, 5, 6] as const) {
    const state = p.steps[step]
    if (state.status !== 'not_started' && !state.confirmed) state.confirmed = { at: FIRST, block: structuredClone(state.block) as never, basis: {} }
  }
  return projectSchema.parse(p)
}

/** Lukas's edits, then the check and the confirm (what the gate does). */
export function reconfirm(p: Project, step: StepId, edits: Action[], at = AT): Project {
  const edited = edits.reduce(reducer, p)
  const checked = reducer(edited, { type: 'check/store', step, check: { at, source: 'app', block: structuredClone(edited.steps[step].block), results: [] } })
  const confirmed = confirmStep(checked, step, at)
  if (confirmed.steps[step].status !== 'confirmed') throw new Error(`step ${step} was not confirmed`)
  return confirmed
}

export const editCause = (text: string): Action => ({ type: 'item/edit', step: 2, collection: 'causes', id: 'ca1', fields: { text } })
