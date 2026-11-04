import { describe, expect, it } from 'vitest'
import { makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { applyAll, applyChange, canUndo, changeView, rejectChange, undoChange } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project, type Proposal } from '../../../src/domain/schemas/project'

// Step 1 with three target groups (tg1–tg3) and a proposal p1.
function setup(proposal: Proposal): Project {
  return makeProject({
    steps: {
      1: {
        block: {
          targetGroups: [
            makeItem(1, 'targetGroups', { name: 'Kinder' }),
            makeItem(1, 'targetGroups', { name: 'Eltern' }),
            makeItem(1, 'targetGroups', { name: 'Schulen' }),
          ],
        },
        proposals: [proposal],
      },
    },
  })
}

const groups = (p: Project) => p.steps[1].block.targetGroups
const names = (p: Project) => groups(p).map((t) => t.name)
const viewOf = (p: Project, change = 'p1c1') => changeView(p, 1, 'p1', change)
const apply = (p: Project, change = 'p1c1') => applyChange(p, 1, 'p1', change)
const edit = (p: Project, id: string, name: string) =>
  reducer(p, { type: 'item/edit', step: 1, collection: 'targetGroups', id, fields: { name } })

const rename = (targetId: string, name: string, baseRev = 1) =>
  ({ op: 'update', collection: 'targetGroups', targetId, baseRev, fields: { name } }) as const
const addGroup = (tempId: string, name: string) =>
  ({ op: 'add', collection: 'targetGroups', tempId, fields: { name, description: 'neu', reach: 'direct', isFocus: true } }) as const

describe('Proposals: apply, reject, undo', () => {
  it('applies an add with a fresh id, not edited by Lukas', () => {
    const p = apply(setup(makeProposal([addGroup('new:1', 'Trainer')])))
    expect(groups(p).at(-1)).toMatchObject({ id: 'tg4', name: 'Trainer', rev: 1, editedByUser: false, isFocus: true })
    expect(viewOf(p)).toEqual({ kind: 'applied' })
    expect(p.steps[1].proposals[0].changes[0].resultId).toBe('tg4')
    expect(p.steps[1].status).toBe('in_progress')
    expect(projectSchema.safeParse(p).success).toBe(true)
  })

  it('applies an update (rev rises) and a remove', () => {
    let p = setup(makeProposal([rename('tg1', 'Kinder 10–13'), { op: 'remove', collection: 'targetGroups', targetId: 'tg3', baseRev: 1 }]))
    p = apply(apply(p), 'p1c2')
    expect(groups(p).map((t) => [t.id, t.name, t.rev])).toEqual([
      ['tg1', 'Kinder 10–13', 2],
      ['tg2', 'Eltern', 1],
    ])
  })

  it('reject leaves the block alone; undo opens the change again', () => {
    const start = setup(makeProposal([rename('tg1', 'x')]))
    let p = rejectChange(start, 1, 'p1', 'p1c1')
    expect(viewOf(p)).toEqual({ kind: 'rejected' })
    expect(groups(p)).toEqual(groups(start))
    p = undoChange(p, 1, 'p1', 'p1c1')
    expect(viewOf(p)).toEqual({ kind: 'open' })
  })

  it('undo of an applied update restores the text with a higher rev', () => {
    let p = apply(setup(makeProposal([rename('tg1', 'Kinder 10–13')])))
    p = undoChange(p, 1, 'p1', 'p1c1')
    expect(groups(p)[0]).toMatchObject({ name: 'Kinder', rev: 3 })
    expect(viewOf(p)).toEqual({ kind: 'stale', reason: 'edited' })
  })

  it('undo of an applied remove puts the item back at its place', () => {
    let p = apply(setup(makeProposal([{ op: 'remove', collection: 'targetGroups', targetId: 'tg2', baseRev: 1 }])))
    p = undoChange(p, 1, 'p1', 'p1c1')
    expect(groups(p).map((t) => t.id)).toEqual(['tg1', 'tg2', 'tg3'])
  })

  it('undo of an applied add removes the item; its number is not reused', () => {
    let p = apply(setup(makeProposal([addGroup('new:1', 'Trainer')])))
    p = undoChange(p, 1, 'p1', 'p1c1')
    expect(groups(p).map((t) => t.id)).toEqual(['tg1', 'tg2', 'tg3'])
    p = apply(p)
    expect(groups(p).at(-1)!.id).toBe('tg5')
  })

  it('no undo after Lukas edited the applied item, or when another change builds on it', () => {
    let p = apply(setup(makeProposal([rename('tg1', 'Kinder 10–13')])))
    p = edit(p, 'tg1', 'Kinder 9–13')
    expect(canUndo(p, 1, 'p1', 'p1c1')).toBe(false)
    expect(undoChange(p, 1, 'p1', 'p1c1')).toBe(p)

    let q = setup(makeProposal([addGroup('new:1', 'Trainer'), rename('new:1', 'Trainerinnen')]))
    q = apply(apply(q), 'p1c2')
    expect(canUndo(q, 1, 'p1', 'p1c1')).toBe(false)
    expect(canUndo(q, 1, 'p1', 'p1c2')).toBe(true)
  })

  it('an applied or rejected change is not applied twice', () => {
    const p = apply(setup(makeProposal([addGroup('new:1', 'Trainer')])))
    expect(apply(p)).toBe(p)
    expect(rejectChange(p, 1, 'p1', 'p1c1')).toBe(p)
  })
})

describe('Proposals: staleness ("veraltet")', () => {
  it('a manual edit makes an open change stale, so it can never overwrite the edit', () => {
    let p = setup(makeProposal([rename('tg1', 'Vorschlag')]))
    p = edit(p, 'tg1', 'Lukas schreibt das')
    expect(viewOf(p)).toEqual({ kind: 'stale', reason: 'edited' })
    expect(apply(p)).toBe(p)
    expect(names(p)[0]).toBe('Lukas schreibt das')
  })

  it('an edit while the answer streams: baseRev is the rev the assistant saw, so the change arrives stale', () => {
    let p = setup(makeProposal([]))
    const seen = groups(p)[0].rev // snapshot sent with the request
    p = edit(p, 'tg1', 'während des Streamens geändert')
    p = reducer(p, { type: 'proposal/add', step: 1, proposal: makeProposal([rename('tg1', 'Vorschlag', seen)], { id: 'p2' }) })
    expect(changeView(p, 1, 'p2', 'p2c1')).toEqual({ kind: 'stale', reason: 'edited' })
  })

  it('a deleted neighbour does not shift short ids: a change to tg3 still hits tg3', () => {
    let p = setup(makeProposal([rename('tg3', 'Grundschulen')]))
    p = reducer(p, { type: 'item/remove', step: 1, collection: 'targetGroups', id: 'tg2' })
    p = apply(p)
    expect(groups(p).map((t) => [t.id, t.name])).toEqual([
      ['tg1', 'Kinder'],
      ['tg3', 'Grundschulen'],
    ])
  })

  it('a deleted target makes the change stale ("removed")', () => {
    let p = setup(makeProposal([rename('tg2', 'x')]))
    p = reducer(p, { type: 'item/remove', step: 1, collection: 'targetGroups', id: 'tg2' })
    expect(viewOf(p)).toEqual({ kind: 'stale', reason: 'removed' })
  })

  it('an unknown target id is stale, never a crash', () => {
    for (const targetId of ['tg99', 'sh1', 'quatsch', 'new:7']) {
      const p = setup(makeProposal([rename(targetId, 'x')]))
      expect(viewOf(p), targetId).toEqual({ kind: 'stale', reason: 'unknown_target' })
      expect(apply(p)).toBe(p)
    }
  })

  it('an unknown collection, fields that don\'t fit, or touching bookkeeping is stale ("invalid")', () => {
    const cases = [
      { op: 'add', collection: 'goals', tempId: 'new:1', fields: { text: 'x' } },
      { op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { reach: 'manchmal' } },
      { op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { colour: 'rot' } },
      { op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { rev: 9 } },
      { op: 'remove', collection: 'challenge', targetId: 'challenge', baseRev: 1 },
    ] as const
    for (const change of cases) {
      const p = setup(makeProposal([change]))
      expect(viewOf(p), JSON.stringify(change)).toEqual({ kind: 'stale', reason: 'invalid' })
    }
  })

  it('updates a singleton (challenge) like any item', () => {
    const p = apply(setup(makeProposal([{ op: 'update', collection: 'challenge', targetId: 'challenge', baseRev: 1, fields: { text: 'Zu wenige Orte', why: 'Weil …' } }])))
    expect(p.steps[1].block.challenge).toMatchObject({ text: 'Zu wenige Orte', why: 'Weil …', rev: 2 })
  })
})

describe('Proposals: chained changes to one item', () => {
  const chained = () => setup(makeProposal([rename('tg1', 'Kinder 10–13'), { ...rename('tg1', ''), fields: { description: 'aus dem Kiez' } }]))

  it('the second change expects the rev the first left behind', () => {
    let p = apply(chained())
    expect(viewOf(p, 'p1c2')).toEqual({ kind: 'open' })
    p = apply(p, 'p1c2')
    expect(groups(p)[0]).toMatchObject({ name: 'Kinder 10–13', description: 'aus dem Kiez', rev: 3 })
  })

  it('"Alle übernehmen" applies both without making its own changes stale', () => {
    const p = applyAll(chained(), 1, 'p1')
    expect(p.steps[1].proposals[0].changes.map((c) => c.state)).toEqual(['applied', 'applied'])
  })

  it('a manual edit between the two still makes the second stale', () => {
    let p = apply(chained())
    p = edit(p, 'tg1', 'Lukas')
    expect(viewOf(p, 'p1c2')).toEqual({ kind: 'stale', reason: 'edited' })
  })
})

describe('Proposals: temp ids and dependencies', () => {
  // Step 4: a new output and a new link that points to it (activity ac1 → new output).
  const withLink = () =>
    makeProject({
      steps: {
        4: {
          block: { activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt' })] },
          proposals: [
            makeProposal([
              { op: 'add', collection: 'outputs', tempId: 'new:1', fields: { groupId: 'tg1', level: 2, text: '15 Jugendliche pro Nachmittag' } },
              {
                op: 'add',
                collection: 'links',
                tempId: 'new:2',
                fields: { groupId: 'tg1', fromId: 'ac1', toId: 'new:1', because: 'weil …', assumption: 'Sie kommen wieder', evidence: 'eigene_erfahrung', critical: false },
              },
            ]),
          ],
        },
      },
    })

  it('a change that references a new item is blocked until its creator is applied', () => {
    let p = withLink()
    expect(changeView(p, 4, 'p1', 'p1c2')).toEqual({ kind: 'blocked', needs: 'p1c1' })
    expect(applyChange(p, 4, 'p1', 'p1c2')).toBe(p)
    p = applyChange(p, 4, 'p1', 'p1c1')
    p = applyChange(p, 4, 'p1', 'p1c2')
    expect(p.steps[4].block.outputs.map((o) => o.id)).toEqual(['ou1'])
    // The temp id resolved to the real id.
    expect(p.steps[4].block.links.map((l) => [l.id, l.fromId, l.toId])).toEqual([['li1', 'ac1', 'ou1']])
    expect(projectSchema.safeParse(p).success).toBe(true)
  })

  it('rejecting the creator makes dependents stale; undoing the reject opens them again', () => {
    let p = rejectChange(withLink(), 4, 'p1', 'p1c1')
    expect(changeView(p, 4, 'p1', 'p1c2')).toEqual({ kind: 'stale', reason: 'creator_unavailable' })
    p = undoChange(p, 4, 'p1', 'p1c1')
    expect(changeView(p, 4, 'p1', 'p1c2')).toEqual({ kind: 'blocked', needs: 'p1c1' })
  })

  it('a stale creator makes dependents stale too', () => {
    const p = setup(makeProposal([{ ...addGroup('new:1', 'x'), fields: { reach: 'manchmal' } }, rename('new:1', 'y')]))
    expect(viewOf(p, 'p1c2')).toEqual({ kind: 'stale', reason: 'creator_unavailable' })
  })

  it('an update to a new item follows its add, also in "Alle übernehmen" when listed first', () => {
    const p = applyAll(setup(makeProposal([rename('new:1', 'Trainerinnen'), addGroup('new:1', 'Trainer')])), 1, 'p1')
    expect(groups(p).at(-1)).toMatchObject({ id: 'tg4', name: 'Trainerinnen', rev: 2 })
  })

  it('two adds that wait for each other are stale, not an endless loop (defensive)', () => {
    const p = makeProject({
      steps: {
        3: {
          proposals: [
            makeProposal([
              { op: 'add', collection: 'goals', tempId: 'new:1', fields: { groupId: 'tg1', level: 4, text: 'a', causeIds: ['new:2'], timeFrame: '' } },
              { op: 'add', collection: 'goals', tempId: 'new:2', fields: { groupId: 'tg1', level: 4, text: 'b', causeIds: ['new:1'], timeFrame: '' } },
            ]),
          ],
        },
      },
    })
    expect(changeView(p, 3, 'p1', 'p1c1').kind).toBe('stale')
    expect(applyAll(p, 3, 'p1')).toBe(p)
  })
})
