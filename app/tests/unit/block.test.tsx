import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import type { Project } from '../../src/domain/schemas/project'
import { keys } from '../../src/storage/store'
import { App } from '../../src/ui/App'
import { ReferenceChip, WhyField } from '../../src/ui/block/parts'
import { UNDO_MS } from '../../src/ui/block/useRemovals'
import { Session } from '../../src/ui/Session'
import { readyStore } from '../stores'

// Step 1 block panel by hand (implementation plan step 11): inline edits, add, remove + undo,
// the dialog for a target group with content. Session tests check that edits are saved at once.

const filled = () =>
  makeProject({
    steps: {
      1: {
        status: 'in_progress',
        block: {
          challenge: makeItem(1, 'challenge', { text: 'Zu wenig Orte am Nachmittag' }),
          targetGroups: [
            makeItem(1, 'targetGroups', { name: 'Jugendliche', description: '12–17 aus der Siedlung', isFocus: true }, { id: 'tg1' }),
            makeItem(1, 'targetGroups', { name: 'Eltern', reach: 'indirect' }, { id: 'tg2' }),
          ],
          stakeholders: [makeItem(1, 'stakeholders', { role: 'Stiftung', expectations: ['Teilnahmezahlen'] }, { id: 'sh1' })],
        },
      },
    },
  })

const withContent = () => {
  const p = filled()
  p.steps[2].block.problems = [makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Kein Rad' }, { id: 'pb1' })]
  p.steps[3].block.goals = [makeItem(3, 'goals', { groupId: 'tg1', level: 5, text: 'Reparieren selbst' }, { id: 'go1' })]
  p.steps[2].block.consequences = [makeItem(2, 'consequences', { groupId: 'tg2', text: 'Streit' }, { id: 'co1' })]
  p.idCounters = { ...p.idCounters, pb: 1, go: 1, co: 1 }
  return p
}

let latest: Project
function Harness({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial)
  latest = project
  return <App project={project} initialView={{ kind: 'step', step: 1 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} />
}

function openHarness(project = filled(), user = userEvent.setup()) {
  render(<Harness initial={project} />)
  return { user, panel: () => screen.getByRole('region', { name: 'Baustein' }) }
}

async function openSession(project = filled()) {
  const store = readyStore({ [keys.project]: project })
  const user = userEvent.setup()
  render(<Session store={store} />)
  await user.click(await screen.findByRole('button', { name: /^1 Gruppen,/ }))
  return { user, store, stored: async () => (await store.get(keys.project)) as Project }
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement
const fields = (name: string) => screen.getAllByRole('textbox', { name }) as HTMLTextAreaElement[]
const row = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)

afterEach(() => vi.useRealTimers())

describe('block panel: empty block', () => {
  it('shows one muted sentence per list and the challenge placeholder', () => {
    openHarness(makeProject())
    expect(screen.getByText('Noch leer – erzähl der Wirkungshelferin, für wen euer Angebot da ist.')).toBeTruthy()
    expect(screen.getByText('Noch leer – wer hat mit eurem Angebot zu tun oder redet mit?')).toBeTruthy()
    expect(field('Herausforderung').placeholder).toBe('In einem Satz: Welche Herausforderung geht ihr an?')
    expect(screen.getByLabelText('Warum?')).toBeTruthy()
  })
})

describe('block panel: inline edits', () => {
  it('Enter saves: rev rises, editedByUser is set, "von dir geändert" shows, the project is stored at once', async () => {
    const { user, stored } = await openSession()
    expect(within(row('tg2')!).queryByText('von dir geändert')).toBeNull()
    const name = fields('Name der Zielgruppe')[1]
    await user.clear(name)
    await user.type(name, 'Eltern und Großeltern{Enter}')
    expect(document.activeElement).not.toBe(name)
    expect(within(row('tg2')!).getByText('von dir geändert')).toBeTruthy()
    // Well under the 500 ms autosave pause: a deliberate edit doesn't wait for it.
    await waitFor(async () => expect((await stored()).steps[1].block.targetGroups[1]).toMatchObject({ name: 'Eltern und Großeltern', rev: 2, editedByUser: true }), {
      timeout: 200,
    })
  })

  it('blur and Esc save too; nothing typed is lost', async () => {
    const { user } = openHarness()
    await user.click(field('Herausforderung'))
    await user.type(field('Herausforderung'), ' und zu wenig Räder')
    await user.tab()
    expect(latest.steps[1].block.challenge).toMatchObject({ text: 'Zu wenig Orte am Nachmittag und zu wenig Räder', rev: 2 })

    const why = screen.getAllByLabelText('Warum?')[0]
    await user.type(why, 'Weil es kaum Angebote gibt{Escape}')
    expect(latest.steps[1].block.challenge.why).toBe('Weil es kaum Angebote gibt')
    expect(document.activeElement).not.toBe(why)
  })

  it('Shift+Enter makes a new line in a multi-line field; a one-line field never gets one', async () => {
    const { user } = openHarness()
    const description = fields('Beschreibung der Zielgruppe')[1]
    await user.type(description, 'Mütter{Shift>}{Enter}{/Shift}Väter{Enter}')
    expect(latest.steps[1].block.targetGroups[1].description).toBe('Mütter\nVäter')

    const name = fields('Name der Zielgruppe')[0]
    await user.type(name, '{Shift>}{Enter}{/Shift}')
    expect(latest.steps[1].block.targetGroups[0].name).toBe('Jugendliche')
  })

  it('an unchanged field saves nothing (no rev bump)', async () => {
    const { user } = openHarness()
    await user.click(fields('Name der Zielgruppe')[0])
    await user.keyboard('{Enter}')
    expect(latest.steps[1].block.targetGroups[0].rev).toBe(1)
  })

  it('direkt/indirekt, Fokusgruppe and the size are edits too; an emptied size goes', async () => {
    const { user } = openHarness()
    const eltern = row('tg2')!
    await user.click(within(eltern).getByRole('radio', { name: 'direkt' }))
    await user.click(within(eltern).getByRole('checkbox', { name: 'Fokusgruppe' }))
    expect(latest.steps[1].block.targetGroups[1]).toMatchObject({ reach: 'direct', isFocus: true, rev: 3, editedByUser: true })

    const size = within(eltern).getByRole('textbox', { name: 'Größe der Zielgruppe' })
    await user.type(size, 'etwa 30{Enter}')
    expect(latest.steps[1].block.targetGroups[1].sizeEstimate).toBe('etwa 30')
    expect(within(eltern).getByText('Größe:')).toBeTruthy()
    await user.clear(size)
    await user.keyboard('{Enter}')
    expect(latest.steps[1].block.targetGroups[1].sizeEstimate).toBeUndefined()
    expect(within(eltern).queryByText('Größe:')).toBeNull()
  })

  it('expectations: one per line, empty lines dropped', async () => {
    const { user } = openHarness()
    const list = screen.getByLabelText('Erwartungen')
    await user.type(list, '{Shift>}{Enter}{Enter}{/Shift}  Bericht pro Halbjahr {Enter}')
    expect(latest.steps[1].block.stakeholders[0].expectations).toEqual(['Teilnahmezahlen', 'Bericht pro Halbjahr'])
  })

  it('a value applied from outside shows at once in a field that isn’t focused', () => {
    const { rerender } = render(<App project={filled()} initialView={{ kind: 'step', step: 1 }} />)
    const next = reducer(filled(), { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { name: 'Jugendliche 12–14' } })
    rerender(<App project={next} initialView={{ kind: 'step', step: 1 }} />)
    expect(fields('Name der Zielgruppe')[0].value).toBe('Jugendliche 12–14')
  })
})

describe('block panel: adding', () => {
  it('"+ hinzufügen" adds a row with the cursor in its name; typed text stays', async () => {
    const { user } = openHarness()
    await user.click(screen.getByRole('button', { name: 'Zielgruppe hinzufügen' }))
    const name = within(row('tg3')!).getByRole('textbox', { name: 'Name der Zielgruppe' })
    expect(document.activeElement).toBe(name)
    // Nothing written yet: no "von dir geändert" on the empty row.
    expect(within(row('tg3')!).queryByText('von dir geändert')).toBeNull()
    await user.type(name, 'Ehrenamtliche')
    await user.tab()
    await user.click(screen.getByRole('heading', { name: 'Beteiligte' }))
    expect(latest.steps[1].block.targetGroups.at(-1)).toMatchObject({ id: 'tg3', name: 'Ehrenamtliche' })
  })

  it('a new row left completely empty goes again when focus leaves it', async () => {
    const { user } = openHarness()
    await user.click(screen.getByRole('button', { name: 'Beteiligte hinzufügen' }))
    expect(row('sh2')).toBeTruthy()
    await user.tab() // to "Erwartungen", same row: stays
    expect(row('sh2')).toBeTruthy()
    await user.click(field('Herausforderung'))
    expect(row('sh2')).toBeNull()
    expect(latest.steps[1].block.stakeholders.map((s) => s.id)).toEqual(['sh1'])
  })

  it('an existing row that Lukas empties is not dropped by leaving it', async () => {
    const { user } = openHarness()
    const role = within(row('sh1')!).getByRole('textbox', { name: 'Rolle' })
    await user.clear(role)
    await user.clear(screen.getByLabelText('Erwartungen'))
    await user.click(field('Herausforderung'))
    expect(row('sh1')).toBeTruthy()
  })
})

describe('block panel: removing and undo', () => {
  it('✕ removes at once; the undo line takes the row’s place with focus on "Rückgängig"; undo puts it back', async () => {
    const { user } = openHarness()
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Jugendliche“ entfernen' }))
    expect(latest.steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg2'])
    const undo = screen.getByRole('button', { name: 'Rückgängig' })
    expect(document.activeElement).toBe(undo)
    expect(screen.getByText('„Jugendliche“ entfernt.')).toBeTruthy()
    // The line sits where the row was: before "Eltern".
    const items = [...document.querySelectorAll('.blist')[0].children]
    expect(items[0].hasAttribute('data-undo-key')).toBe(true)

    await user.click(undo)
    expect(latest.steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg1', 'tg2'])
    expect(latest.steps[1].block.targetGroups[0].rev).toBe(1)
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull()
    expect(row('tg1')!.contains(document.activeElement)).toBe(true)
  })

  it('the undo line goes after 10 seconds; the removal stays; focus moves to the section', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = openHarness(filled(), userEvent.setup({ advanceTimers: vi.advanceTimersByTime }))
    await user.click(screen.getByRole('button', { name: 'Beteiligte „Stiftung“ entfernen' }))
    act(() => vi.advanceTimersByTime(UNDO_MS - 500))
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull()
    expect(latest.steps[1].block.stakeholders).toEqual([])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Beteiligte hinzufügen' }))
    // The list is empty again, so its hint is back.
    expect(screen.getByText('Noch leer – wer hat mit eurem Angebot zu tun oder redet mit?')).toBeTruthy()
  })

  it('the removal and the undo are both saved at once', async () => {
    const { user, stored } = await openSession()
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Eltern“ entfernen' }))
    await waitFor(async () => expect((await stored()).steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg1']), { timeout: 200 })
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    await waitFor(async () => expect((await stored()).steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg1', 'tg2']), { timeout: 200 })
  })
})

describe('block panel: a target group with content in steps 2–4', () => {
  it('asks first; Abbrechen keeps everything', async () => {
    const { user } = openHarness(withContent())
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Jugendliche“ entfernen' }))
    const dialog = screen.getByRole('dialog', { name: 'Zielgruppe „Jugendliche“ entfernen?' })
    expect(within(dialog).getByText(/In Schritt 2 und 3 gibt es schon 2 Einträge zu dieser Gruppe\./)).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }))
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
    expect(latest).toEqual(withContent())
  })

  it('"Nur als Fokusgruppe abwählen" keeps the group and its content', async () => {
    const { user } = openHarness(withContent())
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Jugendliche“ entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Nur als Fokusgruppe abwählen' }))
    expect(latest.steps[1].block.targetGroups[0]).toMatchObject({ id: 'tg1', isFocus: false, editedByUser: true })
    expect(latest.steps[2].block.problems).toHaveLength(1)
    expect(latest.steps[3].block.goals).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull()
  })

  it('"Endgültig löschen" removes the group and its step 2–4 items, without an undo line', async () => {
    const { user } = openHarness(withContent())
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Jugendliche“ entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
    expect(latest.steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg2'])
    expect(latest.steps[2].block.problems).toEqual([])
    expect(latest.steps[3].block.goals).toEqual([])
    expect(latest.steps[2].block.consequences).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zielgruppe hinzufügen' }))
  })

  it('a non-focus group: only Abbrechen and Endgültig löschen', async () => {
    const { user } = openHarness(withContent())
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Eltern“ entfernen' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/In Schritt 2 gibt es schon einen Eintrag zu dieser Gruppe\./)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Nur als Fokusgruppe abwählen' })).toBeNull()
    // Esc on the native dialog is checked in Chrome (gallery); jsdom has no cancel event.
    await user.click(within(dialog).getByRole('button', { name: 'Schließen' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(latest.steps[1].block.targetGroups).toHaveLength(2)
  })

  it('a group without content goes at once (no dialog)', async () => {
    const { user } = openHarness(withContent())
    await user.click(screen.getByRole('button', { name: 'Zielgruppe hinzufügen' }))
    await user.type(document.activeElement!, 'Trainer{Enter}')
    await user.click(screen.getByRole('button', { name: 'Zielgruppe „Trainer“ entfernen' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('„Trainer“ entfernt.')).toBeTruthy()
  })
})

describe('block parts', () => {
  it('a blocked "Warum?" says "fehlt" in words, not by colour and icon alone', () => {
    render(<WhyField value="" onSave={() => {}} blocked />)
    expect(screen.getByLabelText('Warum? fehlt')).toBeTruthy()
    expect(screen.getByLabelText('Warum? fehlt').getAttribute('aria-invalid')).toBe('true')
  })

  it('a reference shows its text, a broken one "Verweis fehlt"', () => {
    render(
      <>
        <ReferenceChip text="Räder sind teuer" />
        <ReferenceChip />
      </>,
    )
    expect(screen.getByText('Räder sind teuer')).toBeTruthy()
    expect(screen.getByText('Verweis fehlt')).toBeTruthy()
  })
})

describe('block panel: other steps', () => {
  it('steps without a block yet keep the placeholder', async () => {
    const { user } = openHarness()
    await user.click(screen.getByRole('button', { name: /^5 / }))
    expect(within(screen.getByRole('region', { name: 'Baustein' })).getByText(/Noch leer – hier entsteht/)).toBeTruthy()
  })
})
