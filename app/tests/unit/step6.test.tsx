import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject, makeProposal } from '../../src/domain/fixtures'
import type { StoredMessage } from '../../src/domain/schemas/project'
import { reducer } from '../../src/domain/reducer'
import { projectSchema, type Project } from '../../src/domain/schemas/project'
import { App } from '../../src/ui/App'
import { UNDO_MS } from '../../src/ui/block/useRemovals'

// Step 6 panel (implementation plan step 20, design §6.2 "Step 20"): what needs a plan row
// (derived from step 5), plan rows as disclosure records, the Bezug picker, removing a row,
// the hints from steps 0 and 5, and the quality gate.

const indicator = (id: string, focusQuestionId: string, text: string, baseline = 'ab jetzt') =>
  makeItem(5, 'indicators', { focusQuestionId, level: 5, text, baseline, target: 'die Hälfte', why: 'zeigt es' }, { id })
const planRow = (id: string, fields: Record<string, unknown> = {}) =>
  makeItem(6, 'planRows', { indicatorIds: [], mandatoryFigureIds: [], dataSource: 'Anwesenheitsliste', method: 'nachlesen', collector: 'Teamleitung', frequency: 'jeden Monat', ...fields }, { id })

/** fq1: in1, in2 (baseline nachträglich); fq2: in3; figures mf1, mf2. `rows` = step 6's plan rows. */
function project(rows: ReturnType<typeof planRow>[] = []): Project {
  const p = makeProject()
  p.steps[0].block.frame.existingData = ['Anwesenheitslisten', 'Anmeldebögen']
  p.steps[5].status = 'confirmed'
  p.steps[5].block = {
    focusQuestions: [
      makeItem(5, 'focusQuestions', { text: 'Bleiben die Ehrenamtlichen dabei?', reasons: ['kritische_annahme'], audience: 'Vorstand', linkIds: [], goalIds: [], why: 'w' }, { id: 'fq1' }),
      makeItem(5, 'focusQuestions', { text: 'Reparieren die Jugendlichen selbst?', reasons: ['geldgeberin'], audience: 'Stiftung', linkIds: [], goalIds: [], why: 'w' }, { id: 'fq2' }),
    ],
    deferredCandidates: [],
    indicators: [indicator('in1', 'fq1', 'Öffnungstage mit beiden Ehrenamtlichen'), indicator('in2', 'fq1', 'Zahl der Ehrenamtlichen im Winter', 'nachträglich im März'), indicator('in3', 'fq2', 'Anteil, die ihr Rad selbst flicken')],
    mandatoryFigures: [
      makeItem(5, 'mandatoryFigures', { name: 'Teilnehmende nach Geschlecht', target: '120', unit: 'Personen' }, { id: 'mf1' }),
      makeItem(5, 'mandatoryFigures', { name: 'Anzahl Termine', target: '80' }, { id: 'mf2' }),
    ],
  }
  p.steps[6].block = { planRows: rows }
  p.idCounters = { ...p.idCounters, fq: 2, in: 3, mf: 2, pr: rows.length }
  return projectSchema.parse(p)
}

let latest: Project
function Harness({ initial }: { initial: Project }) {
  const [p, setP] = useState(initial)
  latest = p
  return <App project={p} initialView={{ kind: 'step', step: 6 }} onBlockAction={(a) => setP((x) => reducer(x, a))} />
}

function open(p = project()) {
  const user = userEvent.setup()
  render(<Harness initial={p} />)
  return { user, panel: () => screen.getByRole('region', { name: 'Baustein' }) }
}

const coverageRow = (id: string) => document.querySelector<HTMLElement>(`[data-coverage="${id}"]`)!
const record = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!
const toggle = (id: string) => document.querySelector<HTMLButtonElement>(`[data-row-toggle="${id}"]`)!

afterEach(() => vi.useRealTimers())

describe('what needs a plan row', () => {
  it('lists indicators by question, then mandatory figures, each with its coverage line', () => {
    open(project([planRow('pr1', { indicatorIds: ['in1', 'in2'] })]))
    expect([...document.querySelectorAll('[data-coverage]')].map((el) => el.getAttribute('data-coverage'))).toEqual(['in1', 'in2', 'in3', 'mf1', 'mf2'])
    expect(within(coverageRow('in1')).getByText('In Zeile 1')).toBeTruthy()
    expect(within(coverageRow('in2')).getByText(/Ausgangswert: nachträglich im März/)).toBeTruthy()
    expect(within(coverageRow('in3')).getByText('noch ohne Planzeile')).toBeTruthy()
    expect(within(coverageRow('mf1')).getByText('Pflichtangabe')).toBeTruthy()
    expect(screen.getByText('Mit Planzeile: 2 von 3 Indikatoren · 0 von 2 Pflichtangaben')).toBeTruthy()
  })

  it('one plan row per KPI and per mandatory figure: each "Planzeile anlegen" opens its row at Datenquelle; then the list folds away (the plan’s test)', async () => {
    const { user } = open()
    for (const id of ['in1', 'in2', 'in3', 'mf1', 'mf2']) {
      await user.click(within(coverageRow(id)).getByRole('button', { name: /^Planzeile anlegen/ }))
      const fresh = latest.steps[6].block.planRows.at(-1)!
      expect(document.activeElement).toBe(within(record(fresh.id)).getByRole('textbox', { name: /^Datenquelle/ }))
      await user.keyboard('Anwesenheitsliste{Enter}')
    }
    const rows = latest.steps[6].block.planRows
    expect(rows.map((r) => [...r.indicatorIds, ...r.mandatoryFigureIds])).toEqual([['in1'], ['in2'], ['in3'], ['mf1'], ['mf2']])
    expect(screen.getByText('Alle 3 Indikatoren und 2 Pflichtangaben haben eine Planzeile.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Indikatoren und Pflichtangaben aus Schritt 5' }).getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-coverage]')).toBeNull()
    // Every row stays open: each was created by hand.
    expect(rows.every((r) => toggle(r.id).getAttribute('aria-expanded') === 'true')).toBe(true)
  })

  it('"Zur Zeile" opens a closed row and focuses its head', async () => {
    const { user } = open(project([planRow('pr1', { indicatorIds: ['in1'] }), planRow('pr2', { indicatorIds: ['in2'] }), planRow('pr3', { indicatorIds: ['in3'] })]))
    expect(toggle('pr2').getAttribute('aria-expanded')).toBe('false')
    await user.click(within(coverageRow('in2')).getByRole('button', { name: /^Zur Zeile 2/ }))
    expect(toggle('pr2').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(toggle('pr2'))
  })

  it('without indicators or figures in step 5: one sentence and "Zu Schritt 5"', () => {
    const p = project()
    p.steps[5].block.indicators = []
    p.steps[5].block.mandatoryFigures = []
    open(p)
    expect(screen.getByText(/In Schritt 5 gibt es noch keine Indikatoren oder Pflichtangaben/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zu Schritt 5' })).toBeTruthy()
  })
})

describe('plan rows as disclosures', () => {
  const three = () => project([planRow('pr1', { indicatorIds: ['in1', 'in2'] }), planRow('pr2', { mandatoryFigureIds: ['mf1'], method: '' }), planRow('pr3', { dataSource: '', method: '', collector: '', frequency: '' })])

  it('more than two rows start closed: references stay visible, the summary and "Noch leer" stand in for the fields', () => {
    open(three())
    expect(['pr1', 'pr2', 'pr3'].map((id) => toggle(id).getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])
    expect(within(record('pr1')).getByText('Öffnungstage mit beiden Ehrenamtlichen')).toBeTruthy()
    expect(within(record('pr1')).getByText('Anwesenheitsliste · nachlesen · Teamleitung · jeden Monat')).toBeTruthy()
    expect(within(record('pr1')).getByText('Noch leer: Erster Termin, Einwilligung und Datenschutz, Auswertung und Nutzung, Warum?')).toBeTruthy()
    expect(within(record('pr2')).getByText('Pflichtangabe (Geldgeberin)')).toBeTruthy()
    expect(within(record('pr3')).getByText('Noch leer – öffne die Zeile oder lass dir einen Vorschlag machen.')).toBeTruthy()
    expect(within(record('pr3')).getByText(/Noch kein Bezug/)).toBeTruthy()
    expect(within(record('pr1')).queryByRole('textbox', { name: /^Datenquelle/ })).toBeNull()
    expect(toggle('pr3').textContent).toContain('noch ohne Bezug')
  })

  it('two rows or fewer start open; a head toggles; "Alle öffnen" / "Alle schließen" follow the majority', async () => {
    const { user } = open(three())
    await user.click(toggle('pr1'))
    expect(within(record('pr1')).getByRole('textbox', { name: /^Datenquelle/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Alle öffnen' }))
    expect(['pr1', 'pr2', 'pr3'].map((id) => toggle(id).getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true'])
    await user.click(screen.getByRole('button', { name: 'Alle schließen' }))
    expect(['pr1', 'pr2', 'pr3'].map((id) => toggle(id).getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])
  })

  it('open: the seven fields in form order, the hint from step 0 under an empty Datenquelle, step 5’s baselines under Erster Termin', () => {
    open(project([planRow('pr1', { indicatorIds: ['in1', 'in2'], dataSource: '' })]))
    const labels = [...record('pr1').querySelectorAll('.bform__field > label')].map((l) => l.textContent)
    expect(labels).toEqual(['Datenquelle', 'Methode und Instrument', 'Wer erhebt?', 'Wann und wie oft?', 'Erster Termin', 'Einwilligung und Datenschutz', 'Auswertung und Nutzung'])
    expect(within(record('pr1')).getByText('Aus Schritt 0 vorhanden: Anwesenheitslisten, Anmeldebögen')).toBeTruthy()
    expect(within(record('pr1')).getByText('Ausgangswert laut Schritt 5: ab jetzt – „Öffnungstage mit beiden …“')).toBeTruthy()
    expect(within(record('pr1')).getByText('Ausgangswert laut Schritt 5: nachträglich im März – „Zahl der Ehrenamtlichen im …“')).toBeTruthy()
    expect((within(record('pr1')).getByRole('textbox', { name: /^Einwilligung und Datenschutz/ }) as HTMLTextAreaElement).placeholder).toMatch(/„entfällt, keine Angaben von Personen“$/)
  })

  it('a row added by hand opens with "Bezug wählen" focused', async () => {
    const { user } = open(three())
    await user.click(screen.getByRole('button', { name: 'Planzeile hinzufügen' }))
    expect(toggle('pr4').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(within(record('pr4')).getByRole('button', { name: 'Bezug wählen: Zeile 4' }))
  })
})

describe('the Bezug picker', () => {
  it('each tick saves at once; another row’s cover shows; Esc closes and focus goes back', async () => {
    const { user } = open(project([planRow('pr1', { indicatorIds: ['in1'] }), planRow('pr2', { mandatoryFigureIds: ['mf1'] })]))
    await user.click(within(record('pr2')).getByRole('button', { name: 'Bezug ändern: Zeile 2' }))
    const picker = document.querySelector<HTMLElement>('[data-picker="pr2"]')!
    expect(within(picker).getByRole('group', { name: /^Frage 1: Bleiben die Ehrenamtlichen dabei\?/ })).toBeTruthy()
    expect(within(picker).getByText(/· in Zeile 1/)).toBeTruthy()
    // The row's own references don't count as another row's cover.
    expect(within(picker).queryByText(/· in Zeile 2/)).toBeNull()
    await user.click(within(picker).getByRole('checkbox', { name: /Zahl der Ehrenamtlichen im Winter/ }))
    expect(latest.steps[6].block.planRows[1].indicatorIds).toEqual(['in2'])
    await user.keyboard('{Escape}')
    expect(document.querySelector('[data-picker="pr2"]')).toBeNull()
    expect(document.activeElement).toBe(within(record('pr2')).getByRole('button', { name: 'Bezug ändern: Zeile 2' }))
  })

  it('a deleted reference: chip "Verweis fehlt", unticking it in the picker removes it', async () => {
    const p = project([planRow('pr1', { indicatorIds: ['in1', 'gone'] })])
    const { user } = open(p)
    expect(within(record('pr1')).getByText('Verweis fehlt')).toBeTruthy()
    await user.click(within(record('pr1')).getByRole('button', { name: 'Bezug ändern: Zeile 1' }))
    await user.click(screen.getByRole('checkbox', { name: /Verweis fehlt \(gelöscht\)/ }))
    expect(latest.steps[6].block.planRows[0].indicatorIds).toEqual(['in1'])
  })
})

describe('removing a row', () => {
  it('the undo line takes its place, coverage switches back at once; Rückgängig restores it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = open(project([planRow('pr1', { indicatorIds: ['in1'] })]))
    await user.click(screen.getByRole('button', { name: 'Planzeile „Öffnungstage mit beiden Ehrenamtlichen“ entfernen' }))
    expect(screen.getByText(/Planzeile „Öffnungstage mit beiden Ehrenamtlichen“ entfernt\./)).toBeTruthy()
    expect(within(coverageRow('in1')).getByText('noch ohne Planzeile')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[6].block.planRows.map((r) => r.id)).toEqual(['pr1'])
    expect(document.activeElement).toBe(toggle('pr1'))
    act(() => vi.advanceTimersByTime(UNDO_MS + 100))
  })
})

describe('a proposal card', () => {
  const at = '2026-11-10T10:00:00.000Z'
  const fields = (ids: Record<string, string[]>) => ({ indicatorIds: [], mandatoryFigureIds: [], dataSource: 'Liste', method: 'nachlesen', collector: 'Team', frequency: 'monatlich', firstCollection: '', consentNote: '', analysis: '', why: 'w', ...ids })
  function withCard(rows: ReturnType<typeof planRow>[], changes: Parameters<typeof makeProposal>[0]): Project {
    const p = project(rows)
    const proposal = makeProposal(changes, { summary: 'Plan.' })
    p.steps[6].status = 'in_progress'
    p.steps[6].proposals = [proposal]
    const messages: StoredMessage[] = [
      { id: 'm1', at, role: 'user', content: [{ type: 'text', text: 'Plan bitte' }] },
      { id: 'm2', at, role: 'assistant', content: [{ type: 'text', text: 'Hier ist der Plan.' }, { type: 'tool_use', id: proposal.toolUseId, name: 'propose_changes', input: {} }] },
    ]
    p.steps[6].segments = [{ id: 's1', startedAt: at, messages }]
    return p
  }
  const card = () => within(screen.getByRole('article', { name: 'Vorschlag' }))

  it('"Alle übernehmen" with more than two new rows leaves them closed (the summary is the overview)', async () => {
    const adds = ['in1', 'in2', 'in3'].map((id, n) => ({ op: 'add' as const, collection: 'planRows', tempId: `new:${n + 1}`, fields: fields({ indicatorIds: [id] }) }))
    const { user } = open(withCard([], adds))
    await user.click(card().getByRole('button', { name: 'Alle übernehmen' }))
    expect(latest.steps[6].block.planRows).toHaveLength(3)
    expect(['pr1', 'pr2', 'pr3'].map((id) => toggle(id).getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])
  })

  // Keyboard focus on a card row only outlining a closed head (no opening) needs real focus: the gallery test checks it.
  it('a bulk apply that covers everything also folds the coverage list (no lost update between panel and block)', async () => {
    const ids: Record<string, string[]>[] = [{ indicatorIds: ['in1'] }, { indicatorIds: ['in2'] }, { indicatorIds: ['in3'] }, { mandatoryFigureIds: ['mf1', 'mf2'] }]
    const adds = ids.map((r, n) => ({ op: 'add' as const, collection: 'planRows', tempId: `new:${n + 1}`, fields: fields(r) }))
    const { user } = open(withCard([], adds))
    await user.click(card().getByRole('button', { name: 'Alle übernehmen' }))
    expect(screen.getByRole('button', { name: 'Indikatoren und Pflichtangaben aus Schritt 5' }).getAttribute('aria-expanded')).toBe('false')
    expect(['pr1', 'pr2', 'pr3', 'pr4'].map((id) => toggle(id).getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false'])
  })

  it('a single Übernehmen opens a closed row it changes', async () => {
    const rows = [planRow('pr1', { indicatorIds: ['in1'] }), planRow('pr2', { indicatorIds: ['in2'] }), planRow('pr3', { indicatorIds: ['in3'] })]
    const { user } = open(withCard(rows, [{ op: 'update', collection: 'planRows', targetId: 'pr2', baseRev: 1, fields: { collector: 'Honorarkraft' } }]))
    expect(toggle('pr2').getAttribute('aria-expanded')).toBe('false')
    await user.click(card().getByRole('button', { name: /^Übernehmen/ }))
    expect(toggle('pr2').getAttribute('aria-expanded')).toBe('true')
    expect(latest.steps[6].block.planRows[1].collector).toBe('Honorarkraft')
  })
})

describe('frame', () => {
  it('step 6 has the quality gate; the note says when step 5 isn’t confirmed yet', () => {
    const p = project([planRow('pr1')])
    p.steps[5].status = 'in_progress'
    open(p)
    expect(screen.getByRole('button', { name: 'Prüfen und bestätigen' })).toBeTruthy()
    expect(screen.getByText('Schritt 5 ist noch nicht bestätigt – Indikatoren und Pflichtangaben können sich noch ändern.')).toBeTruthy()
  })
})
