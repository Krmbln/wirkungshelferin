import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import { projectSchema, type Project } from '../../src/domain/schemas/project'
import { App } from '../../src/ui/App'
import { UNDO_MS } from '../../src/ui/block/useRemovals'

// Step 5 panel (implementation plan step 19, design §6.2 "Step 19"): candidates derived from
// step 4 with their decision line, question records with their indicators and limits, the
// "Prüft" picker, removing a question with its indicators, mandatory figures.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const goal = (id: string, groupId: string, level: 4 | 5 | 6, text: string) => makeItem(3, 'goals', { groupId, level, text, causeIds: [], timeFrame: '', why: 'x' }, { id })
const link = (id: string, groupId: string, fromId: string, toId: string, fields: Record<string, unknown> = {}) =>
  makeItem(4, 'links', { groupId, fromId, toId, because: 'b', assumption: `Annahme ${id}`, evidence: 'forschung', critical: false, ...fields }, { id })
const question = (id: string, fields: Record<string, unknown> = {}) =>
  makeItem(5, 'focusQuestions', { text: `Frage ${id}?`, reasons: ['eigenes_lernen'], audience: 'Vorstand', linkIds: [], goalIds: ['go2'], why: 'damit', ...fields }, { id })
const indicator = (id: string, focusQuestionId: string, fields: Record<string, unknown> = {}) =>
  makeItem(5, 'indicators', { focusQuestionId, level: 5, text: `Indikator ${id}`, baseline: 'ab jetzt', target: 'die Hälfte', why: 'zeigt es', ...fields }, { id })

/** Candidates li1 (tg1, in fq1), li3 (tg1, open), li4 (tg2, deferred dc1). */
function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche'), group('tg2', true, 'Mädchen')], stakeholders: [makeItem(1, 'stakeholders', { role: 'Jugendamt', expectations: [] }, { id: 'sh1' })] } } },
  })
  p.steps[0].block.frame.requiredFigures = ['Teilnehmende nach Geschlecht', 'Anzahl Termine']
  p.steps[3].status = 'confirmed'
  p.steps[3].block = {
    goals: [goal('go1', 'tg1', 4, 'Sie wissen, wie ein Rad funktioniert'), goal('go2', 'tg1', 5, 'Sie reparieren selbst'), goal('go3', 'tg2', 5, 'Sie schrauben selbst')],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: 'x', why: 'x' }, { id: 'level7' }),
  }
  p.steps[4].status = 'confirmed'
  p.steps[4].block = {
    resources: [],
    activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt', why: 'damit' }, { id: 'ac1' })],
    outputs: [makeItem(4, 'outputs', { groupId: 'tg1', level: 1, text: 'Werkstatt hat offen' }, { id: 'ou1' })],
    links: [
      link('li1', 'tg1', 'ac1', 'ou1', { critical: true, evidence: 'eigene_erfahrung', assumption: 'Die Ehrenamtlichen bleiben dabei' }),
      link('li2', 'tg1', 'ou1', 'go1'),
      link('li3', 'tg1', 'go1', 'go2', { critical: true, evidence: 'unsicher', assumption: 'Zu Hause gibt es Werkzeug' }),
      link('li4', 'tg2', 'ac1', 'go3', { critical: true, evidence: 'unsicher', assumption: 'Ohne Jungen trauen sie sich' }),
    ],
    externalFactors: [],
    sideEffects: [],
  }
  p.steps[5].block = {
    focusQuestions: [question('fq1', { linkIds: ['li1'], goalIds: [], reasons: ['kritische_annahme'] }), question('fq2')],
    deferredCandidates: [makeItem(5, 'deferredCandidates', { linkId: 'li4', reason: 'Das sehen wir jede Woche' }, { id: 'dc1' })],
    indicators: [indicator('in1', 'fq1', { level: 1 }), indicator('in2', 'fq2'), indicator('in3', 'fq2')],
    mandatoryFigures: [makeItem(5, 'mandatoryFigures', { name: 'Teilnehmende nach Geschlecht', target: '15', unit: 'Personen', sourceNote: '' }, { id: 'mf1' })],
  }
  p.idCounters = { ...p.idCounters, tg: 2, sh: 1, go: 3, ac: 1, ou: 1, li: 4, fq: 2, dc: 1, in: 3, mf: 1 }
  return projectSchema.parse(p)
}

let latest: Project
let setLatest: (p: Project) => void
function Harness({ initial }: { initial: Project }) {
  const [p, setP] = useState(initial)
  latest = p
  setLatest = setP
  return <App project={p} initialView={{ kind: 'step', step: 5 }} onBlockAction={(a) => setP((x) => reducer(x, a))} />
}

function open(p = project()) {
  const user = userEvent.setup()
  render(<Harness initial={p} />)
  return { user, panel: () => screen.getByRole('region', { name: 'Baustein' }) }
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!
const candidate = (linkId: string) => document.querySelector<HTMLElement>(`[data-candidate="${linkId}"]`)!
const candidateIds = () => [...document.querySelectorAll('[data-candidate]')].map((el) => el.getAttribute('data-candidate'))
const record = (n: number) => document.querySelectorAll<HTMLElement>('.bquestion')[n]

afterEach(() => vi.useRealTimers())

describe('layout', () => {
  it('three sections in the guide’s order; questions are numbered records with h4 heads and an h5 for their indicators', () => {
    const { panel } = open()
    expect(within(panel()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Kandidaten aus Schritt 4', 'Lernfragen', 'Pflichtangaben (Geldgeberin)'])
    expect(within(panel()).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Frage 1: Frage fq1?', 'Frage 2: Frage fq2?'])
    expect(within(record(0)).getByRole('heading', { level: 5 }).textContent).toBe('Indikatoren')
    expect(screen.getByRole('article', { name: 'Frage 1: Frage fq1?' })).toBeTruthy()
    expect(screen.getByText('2 von höchstens 3 Fragen · 3 von höchstens 6 Indikatoren')).toBeTruthy()
  })

  it('each candidate shows its assumption, its link and evidence, and its decision in words', () => {
    open()
    expect(candidateIds()).toEqual(['li1', 'li3', 'li4'])
    expect(candidate('li1').textContent).toMatch(/Die Ehrenamtlichen bleiben dabei.*Jugendliche · „Offene Werkstatt“ → „Werkstatt hat offen“ · eigene Erfahrung.*Aufgenommen in Frage 1/)
    expect(within(candidate('li3')).getByText('noch offen')).toBeTruthy()
    expect(within(candidate('li4')).getByRole('textbox', { name: 'Zurückgestellt, weil' })).toHaveProperty('value', 'Das sehen wir jede Woche')
    expect(candidate('li1').querySelector('.bitem__remove')).toBeNull()
  })

  it('candidates update when step 4 changes (the plan’s test)', () => {
    open()
    act(() => setLatest(reducer(latest, { type: 'item/edit', step: 4, collection: 'links', id: 'li2', fields: { critical: true, evidence: 'unsicher' } })))
    expect(candidateIds()).toEqual(['li1', 'li2', 'li3', 'li4'])
    act(() => setLatest(reducer(latest, { type: 'item/edit', step: 4, collection: 'links', id: 'li3', fields: { evidence: 'forschung' } })))
    expect(candidateIds()).toEqual(['li1', 'li2', 'li4'])
    act(() => setLatest(reducer(latest, { type: 'item/edit', step: 4, collection: 'links', id: 'li4', fields: { critical: false } })))
    expect(candidateIds()).toEqual(['li1', 'li2'])
    // Its deferral stays visible as an old one.
    expect(screen.getByText('Zurückgestellt, aber kein Kandidat mehr: „Ohne Jungen trauen sie sich“ (nicht mehr kritisch)')).toBeTruthy()
  })

  it('"Für wen?" lists who is there while empty; the uncovered focus group gets its cue', () => {
    const p = project()
    p.steps[5].block.focusQuestions[1].audience = ''
    open(p)
    expect(within(record(1)).getByText('Aus Schritt 1: Jugendamt')).toBeTruthy()
    expect(screen.getByText('Noch keine Lernfrage zu „Mädchen“ – oder sag im Chat, warum die Gruppe diesmal nicht im Fokus steht.')).toBeTruthy()
  })
})

describe('deciding candidates', () => {
  it('"Als Lernfrage aufnehmen" adds a question that tests the link, with the reason ticked, cursor in its text', async () => {
    const { user } = open()
    await user.click(within(candidate('li3')).getByRole('button', { name: /^Als Lernfrage aufnehmen/ }))
    expect(latest.steps[5].block.focusQuestions[2]).toMatchObject({ id: 'fq3', linkIds: ['li3'], reasons: ['kritische_annahme'] })
    expect(document.activeElement).toBe(within(row('fq3')).getByRole('textbox', { name: 'Lernfrage 3' }))
    expect(candidate('li3').textContent).toMatch(/Aufgenommen in Frage 3/)
    // It isn't empty, so leaving it keeps it.
    await user.tab()
    expect(latest.steps[5].block.focusQuestions).toHaveLength(3)
  })

  it('with 3 questions it can’t be used; the reason stands once in the cue', async () => {
    const p = project()
    p.steps[5].block.focusQuestions.push(question('fq3'))
    p.idCounters.fq = 3
    const { user } = open(p)
    const button = within(candidate('li3')).getByRole('button', { name: /^Als Lernfrage aufnehmen/ })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await user.click(button)
    expect(latest.steps[5].block.focusQuestions).toHaveLength(3)
    expect(screen.getAllByText(/Schon 3 Lernfragen – ergänze eine Annahme/)).toHaveLength(1)
  })

  it('"Zurückstellen" focuses the reason; "Doch nicht zurückstellen" leaves an undo line in the decision line', async () => {
    const { user } = open()
    await user.click(within(candidate('li3')).getByRole('button', { name: /^Zurückstellen/ }))
    const reason = within(candidate('li3')).getByRole('textbox', { name: 'Zurückgestellt, weil' })
    expect(document.activeElement).toBe(reason)
    await user.type(reason, 'Läuft seit Jahren{Enter}')
    expect(latest.steps[5].block.deferredCandidates[1]).toMatchObject({ linkId: 'li3', reason: 'Läuft seit Jahren' })
    await user.click(within(candidate('li3')).getByRole('button', { name: /^Doch nicht zurückstellen/ }))
    expect(latest.steps[5].block.deferredCandidates).toHaveLength(1)
    expect(candidate('li3').textContent).toMatch(/Zurückstellung entfernt\.Rückgängig/)
    expect(document.activeElement).toBe(within(candidate('li3')).getByRole('button', { name: 'Rückgängig' }))
    await user.click(within(candidate('li3')).getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[5].block.deferredCandidates[1]).toMatchObject({ linkId: 'li3', reason: 'Läuft seit Jahren' })
    expect(document.activeElement).toBe(within(candidate('li3')).getByRole('textbox', { name: 'Zurückgestellt, weil' }))
  })

  it('after the undo time the line shows "noch offen" again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = open()
    await user.click(within(candidate('li4')).getByRole('button', { name: /^Doch nicht zurückstellen/ }))
    act(() => vi.advanceTimersByTime(UNDO_MS + 10))
    expect(within(candidate('li4')).getByText('noch offen')).toBeTruthy()
  })
})

describe('the "Prüft" picker', () => {
  it('lists the focus groups’ links and goals; a tick saves at once; Esc goes back to the toggle', async () => {
    const { user } = open()
    const toggle = within(row('fq2')).getByRole('button', { name: 'Bezug ändern: Frage 2' })
    await user.click(toggle)
    const picker = row('fq2').querySelector<HTMLElement>('[data-picker]')!
    expect(within(picker).getByRole('group', { name: 'Mädchen' })).toBeTruthy()
    await user.click(within(picker).getByRole('checkbox', { name: /Stufe 4: Sie wissen/ }))
    expect(latest.steps[5].block.focusQuestions[1].goalIds).toEqual(['go2', 'go1'])
    await user.keyboard('{Escape}')
    expect(row('fq2').querySelector('[data-picker]')).toBeNull()
    expect(document.activeElement).toBe(within(row('fq2')).getByRole('button', { name: 'Bezug ändern: Frage 2' }))
  })

  it('ticking a deferred link takes it into the question and removes the deferral, and says so', async () => {
    const { user } = open()
    await user.click(within(row('fq2')).getByRole('button', { name: 'Bezug ändern: Frage 2' }))
    const box = within(row('fq2')).getByRole('checkbox', { name: /„Offene Werkstatt“ → „Sie schrauben selbst“\s?· kritisch\s?· zurückgestellt/ })
    await user.click(box)
    expect(latest.steps[5].block.focusQuestions[1].linkIds).toEqual(['li4'])
    expect(latest.steps[5].block.deferredCandidates).toEqual([])
    expect(screen.getByText(/Zurückstellung von „Offene Werkstatt“ → „Sie schrauben selbst“ aufgehoben/)).toBeTruthy()
    expect(candidate('li4').textContent).toMatch(/Aufgenommen in Frage 2/)
  })

  it('a deleted reference shows "Verweis fehlt" as a chip and as a checked box at the end', async () => {
    const p = project()
    p.steps[5].block.focusQuestions[1].goalIds = ['go9']
    const { user } = open(p)
    expect(within(row('fq2')).getByText('Verweis fehlt')).toBeTruthy()
    await user.click(within(row('fq2')).getByRole('button', { name: 'Bezug ändern: Frage 2' }))
    await user.click(within(row('fq2')).getByRole('checkbox', { name: /Verweis fehlt \(gelöscht\)/ }))
    expect(latest.steps[5].block.focusQuestions[1].goalIds).toEqual([])
  })
})

describe('indicators and limits', () => {
  it('"+ Indikator" is disabled at 2 per question; a new one starts at the question’s first reference’s level', async () => {
    const { user } = open()
    const full = within(record(1)).getByRole('button', { name: 'Indikator hinzufügen: Frage 2' })
    expect(full.getAttribute('aria-disabled')).toBe('true')
    expect(within(record(1)).getByText('Höchstens 2 je Frage.')).toBeTruthy()
    await user.click(within(record(0)).getByRole('button', { name: 'Indikator hinzufügen: Frage 1' }))
    expect(latest.steps[5].block.indicators[3]).toMatchObject({ focusQuestionId: 'fq1', level: 1 })
    // Left empty, it goes again.
    act(() => screen.getByRole('button', { name: 'Lernfrage hinzufügen' }).focus())
    expect(latest.steps[5].block.indicators).toHaveLength(3)
  })

  it('at 6 indicators and 3 questions every "+" says why it can’t be used', () => {
    const p = project()
    p.steps[5].block.focusQuestions.push(question('fq3'))
    p.steps[5].block.indicators.push(indicator('in4', 'fq3'), indicator('in5', 'fq3'), indicator('in6', 'fq1'))
    open(p)
    expect(screen.getByRole('button', { name: 'Lernfrage hinzufügen' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Höchstens 3 Lernfragen.')).toBeTruthy()
    expect(screen.getAllByText('Höchstens 2 je Frage.')).toHaveLength(3)
  })

  it('Stufe 7 warns after the select, never blocks', async () => {
    const { user } = open()
    await user.selectOptions(within(row('in2')).getByRole('combobox', { name: 'Stufe' }), '7')
    expect(latest.steps[5].block.indicators[1].level).toBe(7)
    expect(within(row('in2')).getByText('Stufe 7 sagt wenig aus – lieber 4–6')).toBeTruthy()
  })
})

describe('removing a question', () => {
  it('its indicators go with it; the undo line counts them and brings them all back', async () => {
    const { user } = open()
    await user.click(within(row('fq2')).getByRole('button', { name: 'Lernfrage „Frage fq2?“ entfernen' }))
    expect(latest.steps[5].block.focusQuestions.map((q) => q.id)).toEqual(['fq1'])
    expect(latest.steps[5].block.indicators.map((i) => i.id)).toEqual(['in1'])
    expect(screen.getByText('„Frage fq2?“ und 2 Indikatoren entfernt.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[5].block.indicators.map((i) => i.id)).toEqual(['in1', 'in2', 'in3'])
    expect(latest.steps[5].block.focusQuestions.map((q) => q.id)).toEqual(['fq1', 'fq2'])
  })
})

describe('mandatory figures', () => {
  it('the step 0 list: "angelegt" for an existing row, "Anlegen" creates one and focuses its Soll-Wert', async () => {
    const { user } = open()
    const noted = screen.getByText('In Schritt 0 notiert:').parentElement!
    expect(noted.textContent).toMatch(/Teilnehmende nach Geschlecht · angelegt/)
    await user.click(within(noted).getByRole('button', { name: 'Anlegen: Anzahl Termine' }))
    expect(latest.steps[5].block.mandatoryFigures[1]).toMatchObject({ id: 'mf2', name: 'Anzahl Termine' })
    expect(document.activeElement).toBe(within(row('mf2')).getByRole('textbox', { name: 'Soll-Wert: Pflichtangabe „Anzahl Termine“' }))
    expect(noted.textContent).toMatch(/Anzahl Termine · angelegt/)
  })

  it('each row is labelled "Pflichtangabe"; they don’t change the indicator count', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Pflichtangabe hinzufügen' }))
    await user.keyboard('Anzahl reparierter Räder{Enter}')
    expect(within(row('mf2')).getByText('Pflichtangabe')).toBeTruthy()
    expect(screen.getByText('2 von höchstens 3 Fragen · 3 von höchstens 6 Indikatoren')).toBeTruthy()
  })
})
