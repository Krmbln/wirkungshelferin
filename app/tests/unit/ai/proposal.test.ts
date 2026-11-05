// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { errorToolResult, proposalResultText, proposalToolResult, toProposal } from '../../../src/ai/proposal'
import { stepOf } from '../../../src/domain/block'
import { emptyFields } from '../../../src/domain/schemas/blocks'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { changeView } from '../../../src/domain/proposals'
import { reducer } from '../../../src/domain/reducer'
import type { Project } from '../../../src/domain/schemas/project'

// From a propose_changes call to a Proposal and back to the tool_result (tech design §6.3, §6.4).

const group = (fields: Record<string, unknown> = {}) => ({ ...emptyFields(1, 'targetGroups'), sizeEstimate: '', why: '', ...fields })

function project(): Project {
  return makeProject({
    steps: {
      1: {
        block: {
          challenge: makeItem(1, 'challenge', { text: 'Jugendliche sind wenig mobil.' }, { rev: 2 }),
          targetGroups: [makeItem(1, 'targetGroups', { name: 'Jugendliche', description: 'aus der Siedlung', why: 'Hauptgruppe' })],
        },
      },
    },
  })
}

const meta = (p: Project) => ({ seen: structuredClone(stepOf(p, 1).block), toolUseId: 'toolu_1', proposalId: 'p1', at: '2026-11-05T10:00:00.000Z' })
const call = (changes: unknown[]) => ({ summary: 'Zielgruppen ergänzt.', changes })

describe('toProposal', () => {
  it('add: temp id kept, fields as sent; applying hands out the real id', () => {
    const p = project()
    const result = toProposal(1, call([{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: group({ name: 'Eltern', reach: 'indirect' }) }]), meta(p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [change] = result.proposal.changes
    expect(change).toMatchObject({ id: 'p1c1', op: 'add', tempId: 'new:1', state: 'open' })
    const next = reducer(reducer(p, { type: 'proposal/add', step: 1, proposal: result.proposal }), { type: 'change/applyAll', step: 1, proposalId: 'p1' })
    expect(next.steps[1].proposals[0].changes[0].resultId).toBe('tg2')
    expect(stepOf(next, 1).block.targetGroups).toHaveLength(2)
  })

  it('update: only the changed fields, baseRev = the rev Claude saw', () => {
    const p = project()
    const result = toProposal(
      1,
      call([{ op: 'update', collection: 'targetGroups', id: 'tg1', fields: group({ name: 'Jugendliche 12–14', description: 'aus der Siedlung', why: 'Hauptgruppe' }) }]),
      meta(p),
    )
    expect(result.ok && result.proposal.changes[0]).toMatchObject({ op: 'update', targetId: 'tg1', baseRev: 1, fields: { name: 'Jugendliche 12–14' } })
  })

  it('singleton update uses its rev; an unchanged update is dropped; nothing left → error', () => {
    const p = project()
    const same = { op: 'update', collection: 'challenge', id: 'challenge', fields: { text: 'Jugendliche sind wenig mobil.', why: '' } }
    const changed = { ...same, fields: { text: 'Jugendliche kommen selten aus der Siedlung heraus.', why: '' } }
    const ok = toProposal(1, call([same, changed]), meta(p))
    expect(ok.ok && ok.proposal.changes).toEqual([expect.objectContaining({ id: 'p1c1', targetId: 'challenge', baseRev: 2 })])
    expect(toProposal(1, call([same]), meta(p))).toEqual({ ok: false, errors: ['Der Vorschlag ändert nichts am Baustein.'] })
  })

  it('remove carries the seen rev; changes to a temp id of the same proposal are allowed', () => {
    const p = project()
    const result = toProposal(
      1,
      call([
        { op: 'remove', collection: 'targetGroups', id: 'tg1' },
        { op: 'add', collection: 'stakeholders', id: 'new:1', fields: { role: 'Stiftung', expectations: [] } },
        { op: 'update', collection: 'stakeholders', id: 'new:1', fields: { role: 'Stiftung', expectations: ['Zahlen'] } },
      ]),
      meta(p),
    )
    expect(result.ok && result.proposal.changes.map((c) => [c.op, c.targetId ?? c.tempId, c.baseRev])).toEqual([
      ['remove', 'tg1', 1],
      ['add', 'new:1', undefined],
      ['update', 'new:1', undefined],
    ])
  })

  it.each([
    ['add without a temp id', [{ op: 'add', collection: 'targetGroups', id: 'tg9', fields: group() }], 'vorläufige ID'],
    ['duplicate temp id', [1, 2].map(() => ({ op: 'add', collection: 'targetGroups', id: 'new:1', fields: group() })), 'doppelt'],
    ['unknown id', [{ op: 'update', collection: 'targetGroups', id: 'tg7', fields: group() }], 'tg7 gibt es'],
    ['temp id not created before', [{ op: 'update', collection: 'targetGroups', id: 'new:3', fields: group() }], 'nicht vorher angelegt'],
    ['missing field', [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: { name: 'x' } }], 'changes.0'],
  ])('error: %s', (_, changes, text) => {
    const result = toProposal(1, call(changes), meta(project()))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors.join(' ')).toContain(text)
  })

  it('a temp id in fields must be created in the same proposal', () => {
    const p = project()
    const result = toProposal(1, call([{ op: 'update', collection: 'challenge', id: 'challenge', fields: { text: 'siehe new:4', why: 'new:4' } }]), meta(p))
    expect(result).toEqual({ ok: false, errors: ['Änderung 1: new:4 wird in diesem Vorschlag nicht angelegt.'] })
  })

  it('an empty value never clears a filled field (a lazy "" must not wipe Lukas\'s text)', () => {
    const p = project()
    const lazy = toProposal(1, call([{ op: 'update', collection: 'targetGroups', id: 'tg1', fields: group({ name: 'Jugendliche', description: '', why: '' }) }]), meta(p))
    expect(lazy).toEqual({ ok: false, errors: ['Der Vorschlag ändert nichts am Baustein.'] })
    // Filling an empty field still counts.
    const filled = toProposal(1, call([{ op: 'update', collection: 'targetGroups', id: 'tg1', fields: group({ name: 'Jugendliche', description: '', sizeEstimate: 'etwa 15', why: '' }) }]), meta(p))
    expect(filled.ok && filled.proposal.changes[0].fields).toEqual({ sizeEstimate: 'etwa 15' })
  })

  it('an edit by Lukas while the answer streams makes the change stale', () => {
    const p = project()
    const seenNow = meta(p)
    const edited = reducer(p, { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { description: 'nur Mädchen' } })
    const result = toProposal(1, call([{ op: 'update', collection: 'targetGroups', id: 'tg1', fields: group({ name: 'Neu', description: 'aus der Siedlung', why: 'Hauptgruppe' }) }]), seenNow)
    if (!result.ok) throw new Error('expected ok')
    const next = reducer(edited, { type: 'proposal/add', step: 1, proposal: result.proposal })
    expect(changeView(next, 1, 'p1', 'p1c1')).toEqual({ kind: 'stale', reason: 'edited' })
  })
})

describe('tool_result', () => {
  it('reports each change: übernommen with the new id, abgelehnt, offen, veraltet', () => {
    let p = project()
    const result = toProposal(
      1,
      call([
        { op: 'add', collection: 'targetGroups', id: 'new:1', fields: group({ name: 'Eltern' }) },
        { op: 'add', collection: 'stakeholders', id: 'new:2', fields: { role: 'Stiftung', expectations: [] } },
        { op: 'add', collection: 'stakeholders', id: 'new:3', fields: { role: 'Schule', expectations: [] } },
        { op: 'update', collection: 'targetGroups', id: 'tg1', fields: group({ name: 'Neu' }) },
      ]),
      meta(p),
    )
    if (!result.ok) throw new Error('expected ok')
    p = reducer(p, { type: 'proposal/add', step: 1, proposal: result.proposal })
    p = reducer(p, { type: 'change/apply', step: 1, proposalId: 'p1', changeId: 'p1c1' })
    p = reducer(p, { type: 'change/reject', step: 1, proposalId: 'p1', changeId: 'p1c2' })
    p = reducer(p, { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { description: 'x' } })
    const proposal = p.steps[1].proposals[0]
    expect(proposalResultText(p, 1, proposal)).toBe(
      [
        'Vorschlag p1:',
        '1. hinzufügen new:1 (targetGroups): übernommen, neue ID tg2',
        '2. hinzufügen new:2 (stakeholders): abgelehnt',
        '3. hinzufügen new:3 (stakeholders): offen',
        '4. ändern tg1 (targetGroups): veraltet',
      ].join('\n'),
    )
    expect(proposalToolResult(p, 1, proposal)).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
  })

  it('a broken call comes back as an error result listing the problems', () => {
    expect(errorToolResult('toolu_9', ['a', 'b'])).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_9',
      is_error: true,
      content: 'Vorschlag nicht angezeigt. Bitte korrigieren und neu vorschlagen:\n- a\n- b',
    })
  })
})
