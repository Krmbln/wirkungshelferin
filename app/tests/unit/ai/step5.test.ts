// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { toProposal } from '../../../src/ai/proposal'
import { operatingRules } from '../../../src/ai/rules'
import { proposeInput } from '../../../src/ai/tools'
import { stepOf, type LooseBlock } from '../../../src/domain/block'
import { groupsOf } from '../../../src/domain/check'
import { makeItem, makeProject } from '../../../src/domain/fixtures'
import { applyAll, changeView } from '../../../src/domain/proposals'
import { projectSchema, type Project, type Proposal } from '../../../src/domain/schemas/project'
import { limitText, rowText } from '../../../src/ui/proposals/describe'

// Step 5 proposals (implementation plan step 19): what the app refuses back to Claude, a new
// question with its indicators in one proposal, removing a question, and how a card names
// questions (never by number), indicators, deferrals and mandatory figures.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const link = (id: string, groupId: string, fromId: string, toId: string, fields: Record<string, unknown> = {}) =>
  makeItem(4, 'links', { groupId, fromId, toId, because: 'b', assumption: `Annahme ${id}`, evidence: 'forschung', critical: false, ...fields }, { id })

function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche 12–17'), group('tg2', true, 'Mädchen'), group('tg3', false, 'Eltern')] } } },
  })
  p.steps[3].block = {
    goals: [
      makeItem(3, 'goals', { groupId: 'tg1', level: 5, text: 'Sie reparieren ihr Rad selbst', causeIds: [], timeFrame: '', why: '' }, { id: 'go1' }),
      makeItem(3, 'goals', { groupId: 'tg3', level: 4, text: 'Eltern wissen Bescheid', causeIds: [], timeFrame: '', why: '' }, { id: 'go2' }),
    ],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: '', why: '' }, { id: 'level7' }),
  }
  p.steps[4].block = {
    resources: [],
    activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt am Nachmittag', why: 'damit' }, { id: 'ac1' })],
    outputs: [makeItem(4, 'outputs', { groupId: 'tg1', level: 1, text: 'Werkstatt hat zweimal pro Woche offen' }, { id: 'ou1' })],
    links: [
      link('li1', 'tg1', 'ac1', 'ou1', { critical: true, evidence: 'eigene_erfahrung', assumption: 'Die Ehrenamtlichen bleiben das ganze Jahr dabei' }),
      link('li2', 'tg1', 'ou1', 'go1', { critical: true, evidence: 'eigene_daten' }),
      link('li3', 'tg3', 'ac1', 'go2', { critical: true, evidence: 'unsicher' }),
    ],
    externalFactors: [],
    sideEffects: [],
  }
  p.steps[5].block = {
    focusQuestions: [
      makeItem(5, 'focusQuestions', { text: 'Bleiben die Ehrenamtlichen dabei?', reasons: ['kritische_annahme'], audience: 'Vorstand', linkIds: ['li1'], goalIds: [], why: 'damit' }, { id: 'fq1' }),
    ],
    deferredCandidates: [],
    indicators: [makeItem(5, 'indicators', { focusQuestionId: 'fq1', level: 1, text: 'Öffnungstage mit beiden', baseline: 'ab jetzt', target: '20 von 24', why: 'zeigt es' }, { id: 'in1' })],
    mandatoryFigures: [],
  }
  p.idCounters = { ...p.idCounters, tg: 3, go: 2, ac: 1, ou: 1, li: 3, fq: 1, in: 1 }
  return projectSchema.parse(p)
}

const meta = (p: Project) => ({
  seen: structuredClone(stepOf(p, 5).block),
  toolUseId: 'toolu_1',
  proposalId: 'p1',
  at: '2026-11-09T10:00:00.000Z',
  groups: groupsOf(p),
  step3: p.steps[3].block as unknown as LooseBlock,
  step4: p.steps[4].block as unknown as LooseBlock,
})
const questionFields = (fields: Record<string, unknown> = {}) => ({ text: 'Reparieren sie selbst?', reasons: ['geldgeberin'], audience: 'Stiftung', linkIds: [], goalIds: ['go1'], why: 'w', ...fields })
const indicatorFields = (fields: Record<string, unknown> = {}) => ({ focusQuestionId: 'fq1', level: 5, text: 'Anteil, die selbst flicken', baseline: 'ab jetzt', target: 'die Hälfte', why: 'w', ...fields })
const run = (p: Project, changes: unknown[]) => toProposal(5, { summary: 'Fokus.', question: 'Passt das so?', changes }, meta(p))
const errors = (p: Project, changes: unknown[]) => {
  const r = run(p, changes)
  return r.ok ? [] : r.errors
}
const proposalOf = (p: Project, changes: unknown[]): Proposal => {
  const r = run(p, changes)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.proposal
}

describe('tool rules (refused back to Claude)', () => {
  it('the schema: reasons are one or more of three, no baselinePlan or rubricNote any more', () => {
    const fields = (proposeInput(5).shape.changes.element as unknown as { options: { shape: Record<string, { shape?: Record<string, unknown> }> }[] }).options
    const indicator = fields.find((o) => (o.shape.collection as unknown as { value: string }).value === 'indicators')!.shape.fields.shape!
    expect(Object.keys(indicator).sort()).toEqual(['baseline', 'focusQuestionId', 'level', 'target', 'text', 'why'])
    expect(run(project(), [{ op: 'add', collection: 'focusQuestions', id: 'new:1', fields: questionFields({ reasons: ['weil'] }) }]).ok).toBe(false)
  })

  it('"Prüft" names links and goals of focus groups only', () => {
    expect(errors(project(), [{ op: 'add', collection: 'focusQuestions', id: 'new:1', fields: questionFields({ linkIds: ['li3', 'li9'], goalIds: ['go2'] }) }])).toEqual([
      'Änderung 1: linkIds "li3" ist keine Verbindung einer Fokusgruppe aus Schritt 4.',
      'Änderung 1: linkIds "li9" ist keine Verbindung einer Fokusgruppe aus Schritt 4.',
      'Änderung 1: goalIds "go2" ist kein Ziel einer Fokusgruppe aus Schritt 3.',
    ])
  })

  it('at most 3 questions, 2 indicators per question, 6 in total — counted with every change applied', () => {
    const p = project()
    const add = (n: number) => ({ op: 'add', collection: 'focusQuestions', id: `new:${n}`, fields: questionFields() })
    expect(errors(p, [add(1), add(2), add(3)])[0]).toMatch(/^Höchstens 3 Lernfragen; der Vorschlag ergäbe 4/)
    // Removing one in the same proposal makes room.
    expect(errors(p, [add(1), add(2), add(3), { op: 'remove', collection: 'focusQuestions', id: 'fq1' }])).toEqual([])
    const ind = (n: number, q = 'fq1') => ({ op: 'add', collection: 'indicators', id: `new:${n}`, fields: indicatorFields({ focusQuestionId: q }) })
    expect(errors(p, [ind(1), ind(2)])).toContain('Änderung 2: Höchstens 2 Indikatoren je Lernfrage (fq1).')
  })

  it('a seventh indicator is refused, mandatory figures are not counted', () => {
    const p = project()
    const add = (n: number) => ({ op: 'add', collection: 'focusQuestions', id: `new:${n}`, fields: questionFields() })
    const ind = (n: number, q: string) => ({ op: 'add', collection: 'indicators', id: `new:${n}`, fields: indicatorFields({ focusQuestionId: q }) })
    const six = [add(1), add(2), ind(3, 'new:1'), ind(4, 'new:1'), ind(5, 'new:2'), ind(6, 'new:2'), ind(7, 'fq1')]
    expect(errors(p, six)).toEqual([])
    const figures = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ op: 'add', collection: 'mandatoryFigures', id: `new:${20 + n}`, fields: { name: `Zahl ${n}`, target: '1', unit: '', sourceNote: '' } }))
    expect(errors(p, [...six, ...figures])).toEqual([])
    expect(errors(p, [...six, ind(8, 'fq1')])[0]).toMatch(/^Höchstens 6 Indikatoren insgesamt; der Vorschlag ergäbe 7/)
  })

  it('an indicator’s question exists or comes in the same proposal', () => {
    expect(errors(project(), [{ op: 'add', collection: 'indicators', id: 'new:1', fields: indicatorFields({ focusQuestionId: 'fq7' }) }])).toEqual([
      'Änderung 1: focusQuestionId "fq7" ist keine Lernfrage (auch keine, die dieser Vorschlag anlegt).',
    ])
  })

  it('a deferral names a current candidate, once, and never one a question tests', () => {
    const p = project()
    const defer = (linkId: string, n = 1) => ({ op: 'add', collection: 'deferredCandidates', id: `new:${n}`, fields: { linkId, reason: 'später' } })
    expect(errors(p, [defer('li2')])[0]).toMatch(/linkId "li2" ist kein Kandidat/)
    expect(errors(p, [defer('li3')])[0]).toMatch(/linkId "li3" ist kein Kandidat/) // not a focus group
    expect(errors(p, [defer('li1')])).toContain('Änderung 1: Eine Lernfrage prüft li1 schon; eine Annahme ist aufgenommen oder zurückgestellt, nicht beides.')
    const free = project()
    free.steps[5].block.focusQuestions[0].linkIds = []
    free.steps[5].block.focusQuestions[0].goalIds = ['go1']
    expect(errors(free, [defer('li1')])).toEqual([])
    expect(errors(free, [defer('li1'), defer('li1', 2)])).toContain('Änderung 2: li1 ist schon zurückgestellt. Ändere die vorhandene Zurückstellung (update).')
  })

  it('a question may take a deferred link only when the same proposal removes the deferral', () => {
    const p = project()
    p.steps[5].block.focusQuestions[0].linkIds = []
    p.steps[5].block.focusQuestions[0].goalIds = ['go1']
    p.steps[5].block.deferredCandidates = [makeItem(5, 'deferredCandidates', { linkId: 'li1', reason: 'später' }, { id: 'dc1' })]
    const take = { op: 'update', collection: 'focusQuestions', id: 'fq1', fields: questionFields({ text: 'Bleiben die Ehrenamtlichen dabei?', linkIds: ['li1'] }) }
    expect(errors(p, [take])[0]).toMatch(/ist zurückgestellt \(dc1\)/)
    expect(errors(p, [take, { op: 'remove', collection: 'deferredCandidates', id: 'dc1' }])).toEqual([])
  })

  it('removing a question drops the separate removals of its indicators (they go with it)', () => {
    const prop = proposalOf(project(), [
      { op: 'remove', collection: 'indicators', id: 'in1' },
      { op: 'remove', collection: 'focusQuestions', id: 'fq1' },
    ])
    expect(prop.changes.map((c) => [c.op, c.collection])).toEqual([['remove', 'focusQuestions']])
  })
})

describe('a new question with its indicators', () => {
  it('Alle übernehmen resolves the temp ids', () => {
    const p = project()
    p.steps[5].proposals = [
      proposalOf(p, [
        { op: 'add', collection: 'focusQuestions', id: 'new:1', fields: questionFields() },
        { op: 'add', collection: 'indicators', id: 'new:2', fields: indicatorFields({ focusQuestionId: 'new:1' }) },
      ]),
    ]
    expect(changeView(p, 5, 'p1', 'p1c2')).toEqual({ kind: 'blocked', needs: 'p1c1' })
    const done = applyAll(p, 5, 'p1')
    expect(done.steps[5].block.indicators[1].focusQuestionId).toBe('fq2')
  })
})

describe('card wording (never a question number, never an id)', () => {
  const row = (p: Project, prop: Proposal, i: number) => rowText(p, 5, prop, prop.changes[i], changeView(p, 5, prop.id, prop.changes[i].id))

  it('reasons come in the checkboxes’ order, so a reordering alone is no change', () => {
    const p = project()
    const r = run(p, [{ op: 'update', collection: 'focusQuestions', id: 'fq1', fields: questionFields({ text: 'Bleiben die Ehrenamtlichen dabei?', reasons: ['kritische_annahme'], audience: 'Vorstand', why: 'damit', linkIds: ['li1'], goalIds: [] }) }])
    expect(r.ok).toBe(false) // nothing changes
    const twice = proposalOf(p, [{ op: 'add', collection: 'focusQuestions', id: 'new:1', fields: questionFields({ reasons: ['kritische_annahme', 'geldgeberin', 'kritische_annahme'] }) }])
    expect(twice.changes[0].fields?.reasons).toEqual(['geldgeberin', 'kritische_annahme'])
  })

  it('a question shows reasons, audience and what it tests; an indicator names its question by text', () => {
    const p = project()
    const prop = proposalOf(p, [
      { op: 'add', collection: 'focusQuestions', id: 'new:1', fields: questionFields({ reasons: ['geldgeberin', 'kritische_annahme'], linkIds: ['li2'] }) },
      { op: 'add', collection: 'indicators', id: 'new:2', fields: indicatorFields({ focusQuestionId: 'new:1' }) },
      { op: 'add', collection: 'indicators', id: 'new:3', fields: indicatorFields({ text: 'Zweiter Indikator' }) },
    ])
    expect(row(p, prop, 0)).toMatchObject({
      noun: 'Lernfrage',
      main: 'Reparieren sie selbst?',
      meta: ['Grund: Vorgabe der Geldgeberin, kritische Annahme · für: Stiftung · prüft: „Werkstatt hat zweimal …“ → „Sie reparieren ihr Rad …“, Ziel „Sie reparieren ihr Rad selbst“'],
    })
    expect(row(p, prop, 1)).toMatchObject({ noun: 'Indikator · zu neuer Frage „Reparieren sie selbst?“', meta: ['Stufe 5 · Ausgangswert: ab jetzt · Ziel: die Hälfte'] })
    expect(row(p, prop, 2).noun).toBe('Indikator · zu „Bleiben die Ehrenamtlichen dabei?“')
    for (const i of [0, 1, 2]) expect(JSON.stringify(row(p, prop, i))).not.toMatch(/\b(fq|li|go|in)\d|Frage \d/)
  })

  it('a deferral is named by its assumption; a mandatory figure shows its target', () => {
    const p = project()
    p.steps[5].block.focusQuestions[0].linkIds = []
    p.steps[5].block.focusQuestions[0].goalIds = ['go1']
    const prop = proposalOf(p, [
      { op: 'add', collection: 'deferredCandidates', id: 'new:1', fields: { linkId: 'li1', reason: 'läuft seit Jahren ohne Probleme' } },
      { op: 'add', collection: 'mandatoryFigures', id: 'new:2', fields: { name: 'Teilnehmende nach Geschlecht', target: '15', unit: 'Personen', sourceNote: '' } },
    ])
    expect(row(p, prop, 0)).toMatchObject({ noun: 'Zurückgestellt', main: 'Die Ehrenamtlichen bleiben das ganze Jahr dabei', meta: ['weil: läuft seit Jahren ohne Probleme'] })
    expect(row(p, prop, 1)).toMatchObject({ noun: 'Pflichtangabe', main: 'Teilnehmende nach Geschlecht', meta: ['Soll: 15 · Personen'] })
  })

  it('ÄNDERN: "Prüft" as one line, reasons in words; ENTFERNEN of a question says its indicators go along', () => {
    const p = project()
    const prop = proposalOf(p, [
      { op: 'update', collection: 'focusQuestions', id: 'fq1', fields: questionFields({ text: 'Bleiben die Ehrenamtlichen dabei?', reasons: ['kritische_annahme', 'eigenes_lernen'], audience: 'Vorstand', why: 'damit', linkIds: ['li1'], goalIds: ['go1'] }) },
    ])
    expect(row(p, prop, 0).fields).toEqual([
      { label: 'Grund', before: 'kritische Annahme', after: 'eigenes Lernen, kritische Annahme' },
      { label: 'Prüft', before: '„Offene Werkstatt am …“ → „Werkstatt hat zweimal …“', after: '„Offene Werkstatt am …“ → „Werkstatt hat zweimal …“, Ziel „Sie reparieren ihr Rad selbst“' },
    ])
    const removal = proposalOf(p, [{ op: 'remove', collection: 'focusQuestions', id: 'fq1' }])
    expect(row(p, removal, 0).meta).toEqual(['mit 1 Indikator'])
  })

  it('the reason an Übernehmen waits', () => {
    const p = project()
    const prop = proposalOf(p, [{ op: 'add', collection: 'indicators', id: 'new:1', fields: indicatorFields() }])
    expect(limitText(p, prop, prop.changes[0], 'perQuestion')).toBe('Frage „Bleiben die Ehrenamtlichen dabei?“ hat schon 2 Indikatoren.')
    expect(limitText(p, prop, prop.changes[0], 'questions')).toBe('Schon 3 Lernfragen – entferne zuerst eine.')
    expect(limitText(p, prop, prop.changes[0], 'total')).toBe('Schon 6 Indikatoren – entferne zuerst einen.')
  })
})

describe('operating rules', () => {
  it('say the app derives the candidates, how deciding works, the limits and which criteria the app judges', () => {
    const rules = operatingRules(5, 'text')
    expect(rules).toMatch(/Schritt 5 in der App/)
    expect(rules).toMatch(/leitet sie selbst ab/)
    expect(rules).toMatch(/nie beides/)
    expect(rules).toMatch(/höchstens 6 insgesamt/)
    expect(rules).toMatch(/nie als Indikator/)
    expect(rules).toMatch(/Kriterien 1, 2, 3, 5, 6, 11, 12 und 13 prüft die App selbst/)
    expect(operatingRules(4, 'text')).not.toMatch(/Schritt 5 in der App/)
  })
})
