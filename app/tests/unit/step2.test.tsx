import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject, makeProposal } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import { projectSchema, type Project, type QualityCheck, type StoredMessage } from '../../src/domain/schemas/project'
import { App } from '../../src/ui/App'
import { hiddenText } from '../../src/ui/block/Step2Block'
import { UNDO_MS } from '../../src/ui/block/useRemovals'

// Step 2 panel (implementation plan step 16, design §6.2 "Step 16"): the multi-group layout,
// the cause tree by hand, edge states, and how check and proposals reach collapsed groups.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const cause = (id: string, groupId: string, parentId: string, text: string, why = 'gesehen') => makeItem(2, 'causes', { groupId, parentId, text, why }, { id })

function project(groups = [group('tg1', true, 'Jugendliche'), group('tg2', true, 'Mädchen'), group('tg3', false, 'Eltern')], status: 'confirmed' | 'in_progress' = 'confirmed'): Project {
  const p = makeProject({ steps: { 1: { status, block: { challenge: makeItem(1, 'challenge', { text: 'Wenig Orte am Nachmittag', why: 'weil' }), targetGroups: groups } } } })
  p.steps[2].block = {
    problems: [makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Sie schaffen selten etwas selbst.', why: 'erzählt' }, { id: 'pb1' })],
    causes: [cause('ca1', 'tg1', '', 'Kein eigenes Rad'), cause('ca2', 'tg1', 'ca1', 'Reparaturen sind teuer'), cause('ca3', 'tg1', 'ca2', 'Wenig Geld in den Familien')],
    consequences: [makeItem(2, 'consequences', { groupId: 'tg1', parentId: '', text: 'Wenig Zutrauen' }, { id: 'co1' })],
  }
  p.idCounters = { ...p.idCounters, tg: 9, pb: 1, ca: 3, co: 1 }
  return projectSchema.parse(p)
}

let latest: Project
function Harness({ initial }: { initial: Project }) {
  const [p, setP] = useState(initial)
  latest = p
  return <App project={p} initialView={{ kind: 'step', step: 2 }} onBlockAction={(a) => setP((x) => reducer(x, a))} />
}

function open(p = project()) {
  const user = userEvent.setup()
  render(<Harness initial={p} />)
  return { user, panel: () => screen.getByRole('region', { name: 'Baustein' }) }
}

const toggle = (key: string) => document.querySelector<HTMLButtonElement>(`[data-group-toggle="${key}"]`)!
const row = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)

afterEach(() => vi.useRealTimers())

describe('multi-group layout', () => {
  it('stacks focus groups in step 1 order with "Fokusgruppe n von 2", then "Weitere Zielgruppen" with core problems only', () => {
    const { panel } = open()
    const heads = within(panel()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(heads).toEqual(['JugendlicheFokusgruppe 1 von 2', 'MädchenFokusgruppe 2 von 2', 'Weitere Zielgruppen'])
    expect(toggle('tg1').getAttribute('aria-expanded')).toBe('true')
    const other = document.querySelector('[data-group="other"]') as HTMLElement
    expect(within(other).getByRole('heading', { level: 4, name: 'Eltern' })).toBeTruthy()
    expect(within(other).getByRole('textbox', { name: 'Kernproblem: Eltern' })).toBeTruthy()
    expect(within(other).queryByText('Ursachen')).toBeNull()
  })

  it('one focus group says just "Fokusgruppe", three never say "3 von 2"', () => {
    open(project([group('tg1', true, 'Jugendliche')]))
    expect(toggle('tg1').textContent).toBe('JugendlicheFokusgruppe')
  })

  it('three focus groups are numbered without "von"', () => {
    open(project([group('tg1', true, 'A'), group('tg2', true, 'B'), group('tg3', true, 'C')], 'in_progress'))
    expect(toggle('tg3').textContent).toBe('CFokusgruppe 3')
  })

  it('without focus groups: the sentence, "Zu Schritt 1" and still the other groups; without groups another sentence', async () => {
    const { user } = open(project([group('tg1', false, 'Eltern')], 'in_progress'))
    expect(screen.getByText('Schritt 1 ist noch nicht bestätigt – die Gruppen können sich noch ändern.')).toBeTruthy()
    expect(screen.getByText('Für diesen Schritt brauchst du 1–2 Fokusgruppen aus Schritt 1.')).toBeTruthy()
    expect(toggle('other')).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Zu Schritt 1' })[0])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Zielgruppen/)
  })

  it('no target groups at all', () => {
    open(project([], 'in_progress'))
    expect(screen.getByText('Leg in Schritt 1 zuerst Zielgruppen an.')).toBeTruthy()
  })

  it('collapsing shows the summary line; the state survives a step switch', async () => {
    const { user } = open()
    await user.click(toggle('tg1'))
    expect(toggle('tg1').getAttribute('aria-expanded')).toBe('false')
    expect(row('ca1')).toBeNull()
    expect(screen.getByText('Kernproblem · 3 Ursachen · 1 Folge')).toBeTruthy()
    expect(document.querySelector('[data-group="tg2"] .bgroup__body')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^1 Gruppen,/ }))
    await user.click(screen.getByRole('button', { name: /^2 Problem,/ }))
    expect(toggle('tg1').getAttribute('aria-expanded')).toBe('false')
    await user.click(toggle('tg1'))
    expect(row('ca1')).toBeTruthy()
  })

  it('a group that is no longer a focus group: its causes are hidden and the line says how to get them back', () => {
    const p = project([group('tg1', false, 'Jugendliche'), group('tg2', true, 'Mädchen')])
    open(p)
    expect(row('ca1')).toBeNull()
    expect(screen.getByText(/3 Ursachen und 1 Folge sind ausgeblendet, solange „Jugendliche“ keine Fokusgruppe ist/)).toBeTruthy()
    expect(hiddenText(1, 0, 'X')).toBe('1 Ursache ist ausgeblendet, solange „X“ keine Fokusgruppe ist. Sie kommt zurück, wenn du die Gruppe in Schritt 1 wieder als Fokusgruppe markierst.')
  })
})

describe('problem tree by hand', () => {
  it('typing into an empty core problem creates it for that group', async () => {
    const { user } = open()
    const box = screen.getByRole('textbox', { name: 'Kernproblem: Mädchen' })
    await user.click(box)
    await user.paste('Sie trauen sich nicht an das Werkzeug.')
    await user.keyboard('{Enter}')
    expect(latest.steps[2].block.problems.at(-1)).toMatchObject({ id: 'pb2', groupId: 'tg2', coreProblem: 'Sie trauen sich nicht an das Werkzeug.', editedByUser: true })
  })

  it('"+ Ursache" adds a direct cause, "+ Ursache dafür" one below; the third level offers none', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Ursache hinzufügen: Mädchen' }))
    expect(latest.steps[2].block.causes.at(-1)).toMatchObject({ id: 'ca4', groupId: 'tg2', parentId: '', evidence: 'unsicher' })
    expect(document.activeElement).toBe(row('ca4')!.querySelector('textarea'))
    await user.paste('Werkstatt gilt als Ort für Jungen')
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('button', { name: 'Ursache dafür hinzufügen: unter „Kein eigenes Rad“' }))
    expect(latest.steps[2].block.causes.at(-1)).toMatchObject({ id: 'ca5', groupId: 'tg1', parentId: 'ca1' })
    expect(within(row('ca3')!).queryByRole('button', { name: /Ursache dafür/ })).toBeNull()
    expect(row('ca2')!.closest('ul')!.className).toContain('btree--nested')
  })

  it('evidence and "nicht beeinflussbar" save at once', async () => {
    const { user } = open()
    await user.selectOptions(within(row('ca1')!).getByRole('combobox', { name: 'Evidenzbasis' }), 'eigene_daten')
    await user.click(within(row('ca1')!).getByRole('checkbox'))
    expect(latest.steps[2].block.causes[0]).toMatchObject({ evidence: 'eigene_daten', notInfluenceable: true, editedByUser: true })
  })

  it('removing a cause moves its children up, says so, and Rückgängig puts them back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Ursache „Reparaturen sind teuer“ entfernen' }))
    expect(latest.steps[2].block.causes.find((c) => c.id === 'ca3')!.parentId).toBe('ca1')
    expect(screen.getByText('„Reparaturen sind teuer“ entfernt. 1 Ursache darunter rückt eine Ebene hoch.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[2].block.causes.map((c) => [c.id, c.parentId])).toEqual([
      ['ca1', ''],
      ['ca2', 'ca1'],
      ['ca3', 'ca2'],
    ])
    expect(document.activeElement).toBe(row('ca2')!.querySelector('textarea'))
  })

  it('the undo line goes after 10 seconds; the move stays', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Ursache „Reparaturen sind teuer“ entfernen' }))
    await act(async () => vi.advanceTimersByTime(UNDO_MS + 10))
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull()
    expect(latest.steps[2].block.causes.find((c) => c.id === 'ca3')!.parentId).toBe('ca1')
  })

  it('the challenge stands above Folgen in full; an empty one says so', () => {
    open()
    expect(screen.getAllByText('Die Folgen führen bis zur Herausforderung aus Schritt 1:')).toHaveLength(2)
    expect(screen.getAllByText('Wenig Orte am Nachmittag')[0].className).toContain('refchip--full')
  })
})

const AT = '2026-11-09T10:00:00.000Z'
function blocked(): Project {
  const p = project()
  p.steps[2].block.causes[1] = { ...p.steps[2].block.causes[1], why: '' }
  p.steps[2].block.problems.push(makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Trauen sich nicht', why: 'gesehen' }, { id: 'pb2' }) as never)
  p.idCounters.pb = 2
  const check: QualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[2].block), results: [{ criterion: '2', result: 'warn', note: 'Wenig Ursachen.' }] } as QualityCheck
  p.steps[2].qualityCheck = check as never
  return p
}

describe('check and proposals reach into collapsed groups', () => {
  it('state B names the group; the collapsed summary counts the ⛔; Zum Feld opens the group and focuses the Why', async () => {
    const { user } = open(blocked())
    const gate = screen.getByRole('region', { name: 'Qualitätscheck' })
    expect(within(gate).getByText('Warum fehlt: Ursache „Reparaturen sind teuer“ · Jugendliche')).toBeTruthy()
    expect(within(row('ca2')!).getByText('fehlt')).toBeTruthy()
    await user.click(toggle('tg1'))
    expect(screen.getByText('1 blockiert')).toBeTruthy()
    await user.click(within(gate).getByRole('button', { name: /^Zum Feld: Warum fehlt: Ursache/ }))
    expect(toggle('tg1').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(row('ca2')!.querySelector('[data-field="why"] textarea'))
  })

  it('without focus groups the gate row offers "Zu Schritt 1"', async () => {
    const p = project([group('tg1', false, 'Eltern')], 'in_progress')
    p.steps[2].qualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[2].block), results: [] } as never
    const { user } = open(p)
    const gate = screen.getByRole('region', { name: 'Qualitätscheck' })
    expect(within(gate).getByText('Wähle in Schritt 1 eine oder zwei Fokusgruppen')).toBeTruthy()
    await user.click(within(gate).getByRole('button', { name: 'Zu Schritt 1' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Zielgruppen/)
  })

  function withProposal(): Project {
    const p = project()
    const prop = makeProposal([{ op: 'update', collection: 'causes', targetId: 'ca2', baseRev: 1, fields: { text: 'Reparaturen kosten mehr als ein gebrauchtes Rad' } }])
    const messages: StoredMessage[] = [
      { id: 'm1', at: AT, role: 'user', content: [{ type: 'text', text: 'Reparaturen?' }] },
      { id: 'm2', at: AT, role: 'assistant', content: [{ type: 'text', text: 'So genauer?' }, { type: 'tool_use', id: prop.toolUseId, name: 'propose_changes', input: {} }] },
    ]
    p.steps[2].proposals = [prop]
    p.steps[2].segments = [{ id: 's1', startedAt: AT, messages }]
    return p
  }

  it('hovering a row for a collapsed group outlines its header and opens nothing; Übernehmen opens it', async () => {
    const { user } = open(withProposal())
    await user.click(toggle('tg1'))
    const prow = document.querySelector('[data-change-id="p1c1"]') as HTMLElement
    fireEvent.mouseEnter(prow)
    const header = document.querySelector('[data-group-header="tg1"]')!
    expect(header.hasAttribute('data-outlined')).toBe(true)
    expect(toggle('tg1').getAttribute('aria-expanded')).toBe('false')
    fireEvent.mouseLeave(prow)
    expect(header.hasAttribute('data-outlined')).toBe(false)
    await user.click(within(prow).getByRole('button', { name: /^Übernehmen/ }))
    expect(toggle('tg1').getAttribute('aria-expanded')).toBe('true')
    expect(latest.steps[2].block.causes[1].text).toBe('Reparaturen kosten mehr als ein gebrauchtes Rad')
  })
})
