import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import { projectSchema, type Project, type StoredMessage } from '../../src/domain/schemas/project'
import { App } from '../../src/ui/App'
import { UNDO_MS } from '../../src/ui/block/useRemovals'

// Step 3 panel (implementation plan step 17, design §6.2 "Step 17"): links as chips that follow
// step 2, the cause picker, "trifft nicht zu", non-focus groups, Stufe 7 and "Zu Schritt 2".

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const cause = (id: string, groupId: string, parentId: string, text: string, notInfluenceable = false) =>
  makeItem(2, 'causes', { groupId, parentId, text, why: 'gesehen', notInfluenceable }, { id })

function project(messages: StoredMessage[] = []): Project {
  const p = makeProject({
    steps: {
      1: {
        status: 'confirmed',
        block: { challenge: makeItem(1, 'challenge', { text: 'Wenig Orte am Nachmittag', why: 'weil' }), targetGroups: [group('tg1', true, 'Jugendliche'), group('tg2', false, 'Eltern')] },
      },
    },
  })
  p.steps[2].block = {
    problems: [
      makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Sie schaffen selten etwas selbst.', why: 'erzählt' }, { id: 'pb1' }),
      makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Eltern wissen wenig.', why: 'erzählt' }, { id: 'pb2' }),
    ],
    causes: [cause('ca1', 'tg1', '', 'Kein eigenes Rad'), cause('ca2', 'tg1', 'ca1', 'Reparaturen sind teuer'), cause('ca3', 'tg1', 'ca2', 'Wenig Geld', true)],
    consequences: [],
  }
  p.steps[3].block = {
    goals: [makeItem(3, 'goals', { groupId: 'tg1', level: 5, text: 'Sie reparieren ihr Rad selbst.', causeIds: ['ca2'], timeFrame: 'bis 2027', why: 'damit' }, { id: 'go1' })],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: '', why: '' }, { id: 'level7' }),
  }
  if (messages.length) p.steps[3].segments = [{ id: 's1', startedAt: '2026-11-09T10:00:00.000Z', messages }]
  p.idCounters = { ...p.idCounters, tg: 2, pb: 2, ca: 3, go: 1, na: 0 }
  return projectSchema.parse(p)
}

let latest: Project
function Harness({ initial }: { initial: Project }) {
  const [p, setP] = useState(initial)
  latest = p
  return <App project={p} initialView={{ kind: 'step', step: 3 }} onBlockAction={(a) => setP((x) => reducer(x, a))} />
}

function open(p = project()) {
  const user = userEvent.setup()
  render(<Harness initial={p} />)
  return { user, panel: () => screen.getByRole('region', { name: 'Baustein' }) }
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!
const chips = (id: string) => [...row(id).querySelectorAll('.bgoal__causes .refchip')].map((c) => c.textContent)
const sidebar = (name: RegExp) => within(screen.getByRole('navigation')).getByRole('button', { name })

afterEach(() => vi.useRealTimers())

describe('links follow step 2', () => {
  it('renaming a cause in step 2 renames the goal’s chip', async () => {
    const { user } = open()
    expect(chips('go1')).toEqual(['Reparaturen sind teuer'])
    await user.click(sidebar(/^2 Problem/))
    const field = within(row('ca2')).getAllByRole('textbox')[0]
    await user.clear(field)
    await user.type(field, 'Reparaturen kosten zu viel{Enter}')
    await user.click(sidebar(/^3 Ziele/))
    expect(chips('go1')).toEqual(['Reparaturen kosten zu viel'])
  })

  it('deleting the cause in step 2 → the goal shows "Verweis fehlt" (not a ⛔)', async () => {
    const { user } = open()
    await user.click(sidebar(/^2 Problem/))
    await user.click(within(row('ca2')).getByRole('button', { name: /^Ursache „Reparaturen sind teuer“ entfernen/ }))
    await user.click(sidebar(/^3 Ziele/))
    expect(chips('go1')).toEqual(['Verweis fehlt'])
    expect(row('go1').querySelector('.refchip--missing')).not.toBeNull()
    expect(row('go1').querySelector('.bmissing')).toBeNull()
  })
})

describe('cause picker', () => {
  it('lists the group’s causes as a nested list, ticks link at once, Fertig closes back to the button', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Ursachen ändern: Ziel „Sie reparieren ihr Rad selbst.“' }))
    const picker = screen.getByRole('group', { name: 'Welche Ursachen löst dieses Ziel auf?' })
    const boxes = within(picker).getAllByRole('checkbox')
    expect(document.activeElement).toBe(boxes[0])
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true, false])
    expect(picker.querySelectorAll('ul ul ul li')).toHaveLength(1)
    expect(within(picker).getByText(/nicht beeinflussbar/)).toBeTruthy()
    await user.click(boxes[0])
    expect(latest.steps[3].block.goals[0].causeIds).toEqual(['ca2', 'ca1'])
    expect(chips('go1')).toEqual(['Reparaturen sind teuer', 'Kein eigenes Rad'])
    await user.click(within(picker).getByRole('button', { name: 'Fertig' }))
    expect(screen.queryByRole('group', { name: 'Welche Ursachen löst dieses Ziel auf?' })).toBeNull()
    expect(document.activeElement?.getAttribute('data-picker-toggle')).toBe('go1')
  })

  it('a broken link shows as a checked box; unticking removes it', async () => {
    const p = project()
    p.steps[3].block.goals[0].causeIds = ['ca2', 'ca9']
    const { user } = open(p)
    await user.click(screen.getByRole('button', { name: /^Ursachen ändern/ }))
    await user.click(screen.getByRole('checkbox', { name: /Verweis fehlt/ }))
    expect(latest.steps[3].block.goals[0].causeIds).toEqual(['ca2'])
  })

  it('Esc closes; only one picker is open at a time', async () => {
    const p = project()
    p.steps[3].block.goals.push(makeItem(3, 'goals', { groupId: 'tg1', level: 4, text: 'Sie können flicken.', causeIds: [], timeFrame: '', why: '' }, { id: 'go2' }))
    const { user } = open(p)
    await user.click(screen.getByRole('button', { name: /^Ursachen ändern/ }))
    await user.click(screen.getByRole('button', { name: 'Ursache wählen: Ziel „Sie können flicken.“' }))
    expect(document.querySelectorAll('[data-picker]')).toHaveLength(1)
    expect(document.querySelector('[data-picker="go2"]')).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(document.querySelectorAll('[data-picker]')).toHaveLength(0)
  })
})

describe('levels and marks', () => {
  it('shows Stufe 6 → 5 → 4 per focus group; an empty level offers "+ Ziel" and "Trifft für diese Gruppe nicht zu"', () => {
    open()
    const group = document.querySelector('[data-group="tg1"]') as HTMLElement
    expect(within(group).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
      'Stufe 6 · Lebenslage',
      'Stufe 5 · Handeln',
      'Stufe 4 · Wissen, Einstellung, Fähigkeiten',
    ])
    expect(within(group).getAllByRole('button', { name: /trifft für „Jugendliche“ nicht zu$/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Stufe 6 trifft für „Jugendliche“ nicht zu',
      'Stufe 4 trifft für „Jugendliche“ nicht zu',
    ])
  })

  it('"+ Ziel" adds a row at that level and focuses it; left empty, it goes again', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Ziel hinzufügen: Stufe 4 · Jugendliche' }))
    expect(latest.steps[3].block.goals.at(-1)).toMatchObject({ id: 'go2', groupId: 'tg1', level: 4, causeIds: [] })
    expect(document.activeElement).toBe(row('go2').querySelector('[data-field="text"] textarea'))
    await user.click(screen.getByRole('textbox', { name: 'Stufe 7 · Beitrag zur Gesellschaft' }))
    expect(latest.steps[3].block.goals.map((g) => g.id)).toEqual(['go1'])
  })

  it('marking a level focuses its Why; "+ Ziel" there says why it can’t be used; ✕ removes the mark with undo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Stufe 6 trifft für „Jugendliche“ nicht zu' }))
    expect(latest.steps[3].block.levelNotApplicable[0]).toMatchObject({ id: 'na1', groupId: 'tg1', level: 6 })
    expect(document.activeElement).toBe(row('na1').querySelector('[data-field="why"] textarea'))
    expect(screen.getByRole('textbox', { name: 'Warum: Stufe 6 trifft für „Jugendliche“ nicht zu' })).toBeTruthy()
    const add = screen.getByRole('button', { name: 'Ziel hinzufügen: Stufe 6 · Jugendliche' })
    expect(add.getAttribute('aria-disabled')).toBe('true')
    await user.click(add)
    expect(latest.steps[3].block.goals).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Markierung entfernen: Stufe 6 trifft für „Jugendliche“ nicht zu' }))
    expect(latest.steps[3].block.levelNotApplicable).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[3].block.levelNotApplicable).toHaveLength(1)
    act(() => void vi.advanceTimersByTime(UNDO_MS + 10))
  })

  it('a removed goal leaves its undo line at its place', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Ziel „Sie reparieren ihr Rad selbst.“ entfernen' }))
    expect(screen.getByText(/„Sie reparieren ihr Rad selbst.“ entfernt./)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[3].block.goals.map((g) => g.id)).toEqual(['go1'])
  })

  it('collapsed: one summary line per level', async () => {
    const { user } = open()
    await user.click(document.querySelector<HTMLButtonElement>('[data-group-toggle="tg1"]')!)
    expect(screen.getByText('Stufe 6: leer · Stufe 5: 1 Ziel · Stufe 4: leer')).toBeTruthy()
  })
})

describe('non-focus groups and Stufe 7', () => {
  it('a non-focus group shows its core problem as the link, goals with a level select; new ones start at Stufe 4', async () => {
    const { user } = open()
    const other = document.querySelector('[data-group="other"]') as HTMLElement
    expect(within(other).getByText('Eltern wissen wenig.').classList.contains('refchip')).toBe(true)
    expect(within(other).getByText('Noch kein Ziel – mindestens eins pro Gruppe.')).toBeTruthy()
    await user.click(within(other).getByRole('button', { name: 'Ziel hinzufügen: Eltern' }))
    await user.type(document.activeElement!, 'Eltern wissen, was ihre Kinder lernen.{Enter}')
    expect(latest.steps[3].block.goals.at(-1)).toMatchObject({ groupId: 'tg2', level: 4, causeIds: [] })
    fireEvent.change(within(other).getByRole('combobox', { name: 'Stufe: Ziel „Eltern wissen, was ihre Kinder lernen.“' }), { target: { value: '5' } })
    expect(latest.steps[3].block.goals.at(-1)!.level).toBe(5)
    expect(other.querySelector('.bgoal__causes')).toBeNull()
  })

  it('without a core problem in step 2 it says so and offers "Zu Schritt 2"', async () => {
    const p = project()
    p.steps[2].block.problems = p.steps[2].block.problems.filter((x) => x.groupId !== 'tg2')
    const { user } = open(p)
    expect(screen.getByText(/In Schritt 2 hat „Eltern“ noch kein Kernproblem./)).toBeTruthy()
    await user.click(within(document.querySelector('[data-group="other"]') as HTMLElement).getByRole('button', { name: 'Zu Schritt 2' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Problem/)
  })

  it('Stufe 7 sits last, under the challenge, and is typed into its single field', async () => {
    const { user, panel } = open()
    const heads = within(panel()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(heads.at(-1)).toBe('Stufe 7 · Beitrag zur Gesellschaft')
    expect(within(panel()).getByText('Wenig Orte am Nachmittag').classList.contains('refchip--full')).toBe(true)
    await user.type(screen.getByRole('textbox', { name: 'Stufe 7 · Beitrag zur Gesellschaft' }), 'Das Projekt trägt dazu bei, dass …{Enter}')
    expect(latest.steps[3].block.level7.text).toBe('Das Projekt trägt dazu bei, dass …')
  })
})

describe('"Zu Schritt X" in Claude’s text', () => {
  const answer = (text: string): StoredMessage[] => [
    { id: 'm1', at: '2026-11-09T10:00:00.000Z', role: 'user', content: [{ type: 'text', text: 'Hallo' }] },
    { id: 'm2', at: '2026-11-09T10:00:01.000Z', role: 'assistant', content: [{ type: 'text', text }] },
  ]

  it('an earlier step becomes a button that opens it; the same or a later step stays text', async () => {
    const { user } = open(project(answer('In Schritt 2 fehlt eine Ursache.\n[Zu Schritt 2](#schritt-2)\n\nUnd später: [Zu Schritt 4](#schritt-4), [hier](#schritt-3), [x](#schritt-9)')))
    const log = document.querySelector('.chat__log') as HTMLElement
    expect(within(log).getAllByRole('button').filter((b) => b.hasAttribute('data-step-link')).map((b) => b.textContent)).toEqual(['Zu Schritt 2'])
    expect(within(log).getByText('Zu Schritt 4').tagName).toBe('SPAN')
    expect(within(log).getByText('hier').tagName).toBe('SPAN')
    expect(log.querySelector('a')).toBeNull()
    await user.click(within(log).getByRole('button', { name: 'Zu Schritt 2' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Problem/)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('https links still open in a new tab', () => {
    open(project(answer('[Kursbuch](https://example.org/kursbuch)')))
    const link = screen.getByRole('link', { name: 'Kursbuch' })
    expect(link.getAttribute('target')).toBe('_blank')
  })
})
