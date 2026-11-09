// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toProposal } from '../../../src/ai/proposal'
import { operatingRules } from '../../../src/ai/rules'
import { stepOf, type LooseBlock } from '../../../src/domain/block'
import { groupsOf } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { applyAll, changeView } from '../../../src/domain/proposals'
import { projectSchema, type Project, type Proposal } from '../../../src/domain/schemas/project'
import { rowText } from '../../../src/ui/proposals/describe'

// Step 4 proposals (implementation plan step 18): what the app refuses back to Claude, temp ids
// across new outputs and links, and how a card names links, outputs, factors and side effects.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })

function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche 12–17'), group('tg2', true, 'Mädchen'), group('tg3', false, 'Eltern')] } } },
  })
  p.steps[3].block = {
    goals: [
      makeItem(3, 'goals', { groupId: 'tg1', level: 4, text: 'Sie wissen, wie ein Rad funktioniert', causeIds: [], timeFrame: '', why: '' }, { id: 'go1' }),
      makeItem(3, 'goals', { groupId: 'tg1', level: 6, text: 'Sie sind mobil', causeIds: [], timeFrame: '', why: '' }, { id: 'go2' }),
      makeItem(3, 'goals', { groupId: 'tg2', level: 4, text: 'Sie trauen sich an Werkzeug', causeIds: [], timeFrame: '', why: '' }, { id: 'go3' }),
    ],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: '', why: '' }, { id: 'level7' }),
  }
  p.steps[4].block = {
    resources: [],
    activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt am Nachmittag', why: 'damit' }, { id: 'ac1' })],
    outputs: [
      makeItem(4, 'outputs', { groupId: 'tg1', level: 1, text: 'Werkstatt hat zweimal pro Woche offen' }, { id: 'ou1' }),
      makeItem(4, 'outputs', { groupId: 'tg2', level: 1, text: 'Mädchen-Nachmittag einmal im Monat' }, { id: 'ou2' }),
    ],
    links: [makeItem(4, 'links', { groupId: 'tg1', fromId: 'ac1', toId: 'ou1', because: 'b', assumption: 'a', evidence: 'unsicher', critical: false }, { id: 'li1' })],
    externalFactors: [],
    sideEffects: [],
  }
  p.idCounters = { ...p.idCounters, tg: 3, go: 3, ac: 1, ou: 2, li: 1 }
  return projectSchema.parse(p)
}

const meta = (p: Project) => ({
  seen: structuredClone(stepOf(p, 4).block),
  toolUseId: 'toolu_1',
  proposalId: 'p1',
  at: '2026-11-09T10:00:00.000Z',
  groups: groupsOf(p),
  step3: p.steps[3].block as unknown as LooseBlock,
})
const linkFields = (fields: Record<string, unknown>) => ({ groupId: 'tg1', fromId: 'ou1', toId: 'go1', because: 'weil', assumption: 'Sie kommen', evidence: 'unsicher', critical: false, ...fields })
const addLink = (fields: Record<string, unknown>, id = 'new:1') => ({ op: 'add', collection: 'links', id, fields: linkFields(fields) })
const run = (p: Project, changes: unknown[]) => toProposal(4, { summary: 'Kette.', changes }, meta(p))
const errors = (p: Project, changes: unknown[]) => {
  const r = run(p, changes)
  return r.ok ? [] : r.errors
}

describe('step 4 proposals refused back to Claude', () => {
  it('a link starts at an activity or an own output / goal and ends higher up in the same group', () => {
    expect(errors(project(), [addLink({})])).toEqual([])
    expect(errors(project(), [addLink({ fromId: 'ac1', toId: 'go2' })])).toEqual([])
    expect(errors(project(), [addLink({ fromId: 'ou2' })])[0]).toMatch(/fromId "ou2" ist keine Aktivität und keine Leistung oder kein Ziel von „Jugendliche 12–17“/)
    expect(errors(project(), [addLink({ toId: 'go3' })])[0]).toMatch(/toId "go3" ist keine Leistung und kein Ziel von „Jugendliche 12–17“/)
    expect(errors(project(), [addLink({ toId: 'ac1' })])[0]).toMatch(/toId "ac1" ist keine Leistung/)
  })

  it('never downwards or sideways, never on from Stufe 6, never twice', () => {
    expect(errors(project(), [addLink({ fromId: 'go1', toId: 'ou1' })])[0]).toMatch(/Eine Verbindung führt nach oben – das Ende \(Stufe 1\) muss über dem Start \(Stufe 4\) liegen/)
    expect(errors(project(), [addLink({ fromId: 'ou1', toId: 'ou1' })])[0]).toMatch(/nach oben/)
    expect(errors(project(), [addLink({ fromId: 'go2', toId: 'go1' })])[0]).toMatch(/Stufe 6 ist das Ende der Kette/)
    expect(errors(project(), [addLink({ fromId: 'ac1', toId: 'ou1' })])[0]).toMatch(/Diese Verbindung gibt es für „Jugendliche 12–17“ schon/)
  })

  it('outputs and links only for focus groups', () => {
    expect(errors(project(), [{ op: 'add', collection: 'outputs', id: 'new:1', fields: { groupId: 'tg3', level: 1, text: 'Elternabend' } }])[0]).toMatch(/„Eltern“ ist keine Fokusgruppe/)
  })

  it('an external factor is for all ("") or for one focus group', () => {
    const factor = (groupId: string) => [{ op: 'add', collection: 'externalFactors', id: 'new:1', fields: { groupId, text: 'Schulzeiten ändern sich' } }]
    expect(errors(project(), factor(''))).toEqual([])
    expect(errors(project(), factor('tg2'))).toEqual([])
    expect(errors(project(), factor('tg3'))[0]).toMatch(/„Eltern“ ist keine Fokusgruppe. Ein externer Faktor gilt für alle Fokusgruppen/)
  })

  it('a link to an output removed in the same proposal is refused', () => {
    expect(errors(project(), [{ op: 'remove', collection: 'outputs', id: 'ou1' }, addLink({ fromId: 'ou1' })])[0]).toMatch(/fromId "ou1"/)
  })
})

describe('temp ids across new outputs and links', () => {
  it('new outputs and the links between them in one proposal; Alle übernehmen resolves every id', () => {
    const p = project()
    const r = run(p, [
      { op: 'add', collection: 'outputs', id: 'new:1', fields: { groupId: 'tg1', level: 2, text: '12 Jugendliche kommen regelmäßig' } },
      { op: 'add', collection: 'outputs', id: 'new:2', fields: { groupId: 'tg1', level: 3, text: 'Sie kommen gern' } },
      addLink({ fromId: 'ou1', toId: 'new:1' }, 'new:3'),
      addLink({ fromId: 'new:1', toId: 'new:2' }, 'new:4'),
      addLink({ fromId: 'new:2', toId: 'go1' }, 'new:5'),
    ])
    expect(r.ok).toBe(true)
    const proposal = (r as { proposal: Proposal }).proposal
    const q = { ...p, steps: { ...p.steps, 4: { ...p.steps[4], proposals: [proposal] } } } as Project
    // A link to a new output waits for it.
    expect(changeView(q, 4, 'p1', 'p1c4').kind).toBe('blocked')
    const done = applyAll(q, 4, 'p1')
    const links = done.steps[4].block.links
    expect(links.map((l) => [l.fromId, l.toId])).toEqual([
      ['ac1', 'ou1'],
      ['ou1', 'ou3'],
      ['ou3', 'ou4'],
      ['ou4', 'go1'],
    ])
  })
})

describe('step 4 card wording', () => {
  const card = (p: Project, changes: unknown[], index = 0) => {
    const r = run(p, changes)
    if (!r.ok) throw new Error(r.errors.join('; '))
    return rowText(p, 4, r.proposal, r.proposal.changes[index], { kind: 'open' })
  }

  it('a link is named by its two ends; "weil" and the assumption lead the meta line, then evidence and the mark', () => {
    const text = card(project(), [addLink({ because: 'wer regelmäßig schraubt, versteht das Rad', critical: true, evidence: 'eigene_erfahrung' })])
    expect(text.noun).toBe('Verbindung · Jugendliche 12–17')
    expect(text.main).toBe('„Werkstatt hat zweimal pro Woche offen“ → „Sie wissen, wie ein Rad funktioniert“')
    expect(text.meta).toEqual(['weil: wer regelmäßig schraubt, versteht das Rad · Annahme: Sie kommen', 'eigene Erfahrung', 'kritisch'])
    expect(text.fields).toEqual([])
  })

  it('a link to a new output of the same proposal names that output', () => {
    const text = card(project(), [{ op: 'add', collection: 'outputs', id: 'new:1', fields: { groupId: 'tg1', level: 2, text: '12 kommen' } }, addLink({ fromId: 'ou1', toId: 'new:1' }, 'new:2')], 1)
    expect(text.main).toBe('„Werkstatt hat zweimal pro Woche offen“ → „12 kommen“')
  })

  it('ÄNDERN of an end and of the mark, in words', () => {
    const text = card(project(), [{ op: 'update', collection: 'links', id: 'li1', fields: linkFields({ fromId: 'ac1', toId: 'go1', because: 'b', assumption: 'a', critical: true }) }])
    expect(text.fields).toEqual([
      { label: 'nach', before: '„Werkstatt hat zweimal pro Woche offen“', after: '„Sie wissen, wie ein Rad funktioniert“' },
      { label: 'kritisch', before: 'nicht kritisch', after: 'kritisch' },
    ])
  })

  it('outputs carry level and group, factors their group or "alle Fokusgruppen", side effects whom they concern', () => {
    expect(card(project(), [{ op: 'add', collection: 'outputs', id: 'new:1', fields: { groupId: 'tg2', level: 2, text: 'Acht Mädchen kommen' } }]).noun).toBe('Leistung · Stufe 2 · Mädchen')
    expect(card(project(), [{ op: 'add', collection: 'externalFactors', id: 'new:1', fields: { groupId: '', text: 'Wetter' } }]).noun).toBe('Externer Faktor · alle Fokusgruppen')
    expect(card(project(), [{ op: 'add', collection: 'externalFactors', id: 'new:1', fields: { groupId: 'tg2', text: 'Wetter' } }]).noun).toBe('Externer Faktor · Mädchen')
    const effect = card(project(), [{ op: 'add', collection: 'sideEffects', id: 'new:1', fields: { text: 'Mehr Lärm im Hof', affectedGroup: 'Nachbarn', direction: 'negative' } }])
    expect(effect).toMatchObject({ noun: 'Unbeabsichtigte Wirkung', main: 'Mehr Lärm im Hof', meta: ['negativ', 'betrifft Nachbarn'], fields: [] })
  })
})

describe('step 4 operating rules', () => {
  it('say what the app shows itself, the id rules for links and which criteria the app judges', () => {
    const rules = operatingRules(4, 'text')
    expect(rules).toMatch(/## Schritt 4 in der App/)
    expect(rules).toMatch(/die App zeigt sie in der Kette jeder Fokusgruppe selbst/)
    expect(rules).toMatch(/`groupId: ""` \(alle Fokusgruppen\)/)
    expect(rules).toMatch(/Die Kriterien 6 und 11 prüft die App selbst/)
    expect(operatingRules(3, 'text')).not.toMatch(/Schritt 4 in der App/)
  })
})
