import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import { projectSchema, type Project } from '../../src/domain/schemas/project'
import { App } from '../../src/ui/App'
import { UNDO_MS } from '../../src/ui/block/useRemovals'

// Step 4 panel (implementation plan step 18, design §6.2 "Step 18"): the chain per focus group,
// goals from step 3 read-only, the link picker as a draft, the live critical warning, Umfeld.

const group = (id: string, isFocus: boolean, name: string) => makeItem(1, 'targetGroups', { name, isFocus, why: 'weil' }, { id })
const goal = (id: string, groupId: string, level: 4 | 5 | 6, text: string) => makeItem(3, 'goals', { groupId, level, text, causeIds: [], timeFrame: '', why: 'x' }, { id })
const output = (id: string, groupId: string, level: 1 | 2 | 3, text: string) => makeItem(4, 'outputs', { groupId, level, text }, { id })
const link = (id: string, fromId: string, toId: string, fields: Record<string, unknown> = {}) =>
  makeItem(4, 'links', { groupId: 'tg1', fromId, toId, because: 'weil es wirkt', assumption: 'sie kommen', evidence: 'unsicher', critical: false, ...fields }, { id })

function project(): Project {
  const p = makeProject({
    steps: { 1: { status: 'confirmed', block: { targetGroups: [group('tg1', true, 'Jugendliche'), group('tg2', true, 'Mädchen'), group('tg3', false, 'Eltern')] } } },
  })
  p.steps[2].block.causes = [makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Der Bus fährt selten', notInfluenceable: true, why: 'x' }, { id: 'ca1' })]
  p.steps[3].status = 'confirmed'
  p.steps[3].block = {
    goals: [goal('go1', 'tg1', 4, 'Sie wissen, wie ein Rad funktioniert'), goal('go2', 'tg1', 5, 'Sie reparieren selbst'), goal('go3', 'tg1', 6, 'Sie sind mobil')],
    levelNotApplicable: [],
    level7: makeItem(3, 'level7', { text: 'x', why: 'x' }, { id: 'level7' }),
  }
  p.steps[4].block = {
    resources: [],
    activities: [makeItem(4, 'activities', { text: 'Offene Werkstatt', why: 'damit' }, { id: 'ac1' }), makeItem(4, 'activities', { text: 'Elternabend', why: 'für die Eltern' }, { id: 'ac2' })],
    outputs: [output('ou1', 'tg1', 1, 'Werkstatt hat offen'), output('ou2', 'tg1', 2, 'Zwölf kommen'), output('ou3', 'tg1', 3, 'Sie kommen gern')],
    links: [link('li3', 'ou2', 'ou3'), link('li1', 'ac1', 'ou1'), link('li2', 'ou1', 'ou2'), link('li4', 'ou3', 'go1')],
    externalFactors: [],
    sideEffects: [],
  }
  p.idCounters = { ...p.idCounters, tg: 3, ca: 1, go: 3, ac: 2, ou: 3, li: 4 }
  return projectSchema.parse(p)
}

let latest: Project
function Harness({ initial }: { initial: Project }) {
  const [p, setP] = useState(initial)
  latest = p
  return <App project={p} initialView={{ kind: 'step', step: 4 }} onBlockAction={(a) => setP((x) => reducer(x, a))} />
}

function open(p = project()) {
  const user = userEvent.setup()
  render(<Harness initial={p} />)
  return { user, panel: () => screen.getByRole('region', { name: 'Baustein' }) }
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!
const groupEl = (id: string) => document.querySelector<HTMLElement>(`[data-group="${id}"]`)!
const linkOrder = (groupId: string) => [...groupEl(groupId).querySelectorAll('.blinks > li > [data-item-id]')].map((el) => el.getAttribute('data-item-id'))
const critical = (id: string) => within(row(id)).getByRole('checkbox', { name: /^kritisch: / })

afterEach(() => vi.useRealTimers())

describe('layout', () => {
  it('Ressourcen and Aktivitäten first, the focus groups, then Umfeld und Nebenwirkungen; no "Weitere Zielgruppen" without hidden content', () => {
    const { panel } = open()
    const heads = within(panel()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(heads).toEqual(['Ressourcen', 'Aktivitäten', 'JugendlicheFokusgruppe 1 von 2', 'MädchenFokusgruppe 2 von 2', 'Umfeld und Nebenwirkungen'])
  })

  it('a group reads forward: Stufe 1 → 3, goals 4–6 from step 3, then the links in chain order', () => {
    open()
    const h4 = within(groupEl('tg1')).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(h4).toEqual(['Stufe 1 · Angebot findet statt', 'Stufe 2 · Gruppe wird erreicht', 'Stufe 3 · Gruppe nimmt das Angebot an', 'Stufe 4–6 · Ziele aus Schritt 3', 'Verbindungen'])
    expect(linkOrder('tg1')).toEqual(['li1', 'li2', 'li3', 'li4'])
  })

  it('the goals are read-only chips; a goal no link reaches says so', () => {
    open()
    const goals = within(groupEl('tg1')).getByRole('region', { name: 'Stufe 4–6 · Ziele aus Schritt 3' })
    expect(within(goals).queryByRole('textbox')).toBeNull()
    expect(goals.textContent).toMatch(/Sie wissen, wie ein Rad funktioniert(?! · noch ohne)/)
    expect(goals.textContent).toMatch(/Sie reparieren selbst · noch ohne Verbindung/)
  })

  it('a link row: start chip with its level, "→" and the end chip; each activity says which chain uses it', () => {
    open()
    const chips = [...row('li4').querySelectorAll('.refchip--level')].map((c) => c.textContent)
    expect(chips).toEqual(['Stufe 3 Sie kommen gern', 'Ziel · Stufe 4 Sie wissen, wie ein Rad funktioniert'])
    expect(within(row('ac1')).getByText('In der Kette von: Jugendliche')).toBeTruthy()
    expect(within(row('ac2')).getByText('Noch in keiner Kette')).toBeTruthy()
  })

  it('an empty group gets one lead line instead of hint sentences; step 2’s not-influenceable causes sit above the factors', () => {
    open()
    expect(within(groupEl('tg2')).getByText(/Noch leer – die Wirkungshelferin schlägt dir die ganze Kette für „Mädchen“ vor/)).toBeTruthy()
    expect(groupEl('tg2').querySelectorAll('.bsection__empty').length).toBe(1) // only "noch keine Ziele"
    expect(screen.getByText('Nicht beeinflussbar laut Schritt 2:').parentElement!.textContent).toMatch(/Der Bus fährt selten/)
  })
})

describe('critical assumptions (the plan’s PO test)', () => {
  it('a third ticked box warns at once, on every ticked row and under the list; unticking clears it', async () => {
    const { user } = open()
    await user.click(critical('li1'))
    await user.click(critical('li2'))
    expect(groupEl('tg1').querySelector('.bcritical')!.textContent).toBe('')
    await user.click(critical('li4'))
    expect(groupEl('tg1').querySelector('.bcritical')!.textContent).toBe('3 Annahmen sind als kritisch markiert – höchstens 2 je Gruppe. Behalte die, an denen es am ehesten hakt.')
    expect(groupEl('tg1').querySelector('.bcritical')!.getAttribute('aria-live')).toBe('polite')
    for (const id of ['li1', 'li2', 'li4']) expect(within(row(id)).getByText('3 von höchstens 2 kritisch')).toBeTruthy()
    expect(within(row('li3')).queryByText(/von höchstens 2 kritisch/)).toBeNull()
    await user.click(critical('li2'))
    expect(groupEl('tg1').querySelector('.bcritical')!.textContent).toBe('')
    expect(latest.steps[4].block.links.filter((l) => l.critical).map((l) => l.id)).toEqual(['li1', 'li4'])
  })
})

describe('link picker', () => {
  it('choices are a draft until Fertig; then both ends are saved, the row re-sorts and focus returns to Ändern', async () => {
    const { user } = open()
    await user.click(within(row('li4')).getByRole('button', { name: /^Verbindung ändern: / }))
    const picker = row('li4').querySelector<HTMLElement>('[data-picker]')!
    expect(document.activeElement).toBe(within(picker).getAllByRole('radio')[0])
    await user.click(within(within(picker).getByRole('group', { name: 'Von' })).getByRole('radio', { name: 'Werkstatt hat offen' }))
    await user.click(within(within(picker).getByRole('group', { name: 'Nach' })).getByRole('radio', { name: /Sie sind mobil/ }))
    expect(latest.steps[4].block.links.find((l) => l.id === 'li4')).toMatchObject({ fromId: 'ou3', toId: 'go1' })
    expect(within(picker).getByText('Gespeichert wird erst mit „Fertig“.')).toBeTruthy()
    await user.click(within(picker).getByRole('button', { name: 'Fertig' }))
    expect(latest.steps[4].block.links.find((l) => l.id === 'li4')).toMatchObject({ fromId: 'ou1', toId: 'go3' })
    expect(linkOrder('tg1')).toEqual(['li1', 'li2', 'li4', 'li3'])
    expect(document.activeElement).toBe(within(row('li4')).getByRole('button', { name: /^Verbindung ändern: / }))
  })

  it('Esc closes without saving', async () => {
    const { user } = open()
    await user.click(within(row('li4')).getByRole('button', { name: /^Verbindung ändern: / }))
    const picker = row('li4').querySelector<HTMLElement>('[data-picker]')!
    await user.click(within(picker).getByRole('radio', { name: 'Offene Werkstatt' }))
    await user.keyboard('{Escape}')
    expect(row('li4').querySelector('[data-picker]')).toBeNull()
    expect(latest.steps[4].block.links.find((l) => l.id === 'li4')).toMatchObject({ fromId: 'ou3' })
  })

  it('ends at or below the start are disabled; an end that no longer fits stays with ⚠ and Fertig waits', async () => {
    const { user } = open()
    await user.click(within(row('li2')).getByRole('button', { name: /^Verbindung ändern: / }))
    const picker = row('li2').querySelector<HTMLElement>('[data-picker]')!
    const to = within(picker).getByRole('group', { name: 'Nach' })
    expect((within(to).getByRole('radio', { name: 'Werkstatt hat offen' }) as HTMLInputElement).disabled).toBe(true)
    // Moving the start above the end (ou2): the end stays, flagged.
    await user.click(within(within(picker).getByRole('group', { name: 'Von' })).getByRole('radio', { name: 'Sie kommen gern' }))
    expect(within(to).getByText(/passt nicht mehr – muss über dem Start liegen/)).toBeTruthy()
    expect(within(picker).getByRole('button', { name: 'Fertig' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(within(to).getByRole('radio', { name: /Sie reparieren selbst/ }))
    expect(within(picker).getByRole('button', { name: 'Fertig' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  it('an end that would repeat a link is disabled with "(gibt es schon)"', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen: Jugendliche' }))
    const picker = document.querySelector<HTMLElement>('[data-item-id="li5"] [data-picker]')!
    await user.click(within(within(picker).getByRole('group', { name: 'Von' })).getByRole('radio', { name: 'Offene Werkstatt' }))
    const taken = within(within(picker).getByRole('group', { name: 'Nach' })).getByRole('radio', { name: /^Werkstatt hat offen/ }) as HTMLInputElement
    expect(taken.disabled).toBe(true)
    expect(taken.closest('label')!.textContent).toBe('Werkstatt hat offen (gibt es schon)')
  })

  it('"+ Verbindung" opens its picker at once; left empty, the row goes again', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Verbindung hinzufügen: Jugendliche' }))
    expect(row('li5').querySelector('[data-picker]')).not.toBeNull()
    await user.keyboard('{Escape}')
    expect(row('li5')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ressource hinzufügen' }))
    expect(document.querySelector('[data-item-id="li5"]')).toBeNull()
  })

  it('opening another picker drops a changed draft and says so', async () => {
    const { user } = open()
    await user.click(within(row('li4')).getByRole('button', { name: /^Verbindung ändern: / }))
    await user.click(within(row('li4').querySelector<HTMLElement>('[data-picker]')!).getByRole('radio', { name: 'Offene Werkstatt' }))
    await user.click(within(row('li1')).getByRole('button', { name: /^Verbindung ändern: / }))
    expect(row('li4').querySelector('[data-picker]')).toBeNull()
    expect(screen.getByText('Änderung an „Sie kommen gern“ führt zu „Sie wissen, wie ein Rad funktioniert“ verworfen')).toBeTruthy()
  })
})

describe('removing what a link uses', () => {
  it('the link keeps its texts and shows "Verweis fehlt"; the undo line counts the links and puts it back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = open()
    await user.click(within(row('ou2')).getByRole('button', { name: 'Leistung · Stufe 2 · Jugendliche „Zwölf kommen“ entfernen' }))
    expect(screen.getByText('„Zwölf kommen“ entfernt. 2 Verbindungen zeigen jetzt „Verweis fehlt“.')).toBeTruthy()
    expect(row('li2').querySelector('.refchip--missing')).not.toBeNull()
    expect(row('li3').querySelector('.refchip--missing')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(row('li2').querySelector('.refchip--missing')).toBeNull()
    act(() => vi.advanceTimersByTime(UNDO_MS))
  })
})

describe('Umfeld und Nebenwirkungen', () => {
  it('a new factor is for all focus groups; its group can be chosen; side effects start at "negativ"', async () => {
    const { user } = open()
    await user.click(screen.getByRole('button', { name: 'Externen Faktor hinzufügen' }))
    await user.keyboard('Schulzeiten ändern sich{Enter}')
    const factor = latest.steps[4].block.externalFactors[0]
    expect(factor).toMatchObject({ groupId: '', text: 'Schulzeiten ändern sich' })
    fireEvent.change(within(row(factor.id)).getByRole('combobox', { name: /^Betrifft: / }), { target: { value: 'tg2' } })
    expect(latest.steps[4].block.externalFactors[0].groupId).toBe('tg2')
    await user.click(screen.getByRole('button', { name: 'Unbeabsichtigte Wirkung hinzufügen' }))
    await user.keyboard('Mehr Lärm im Hof{Enter}')
    const effect = latest.steps[4].block.sideEffects[0]
    expect(effect.direction).toBe('negative')
    expect((within(row(effect.id)).getByRole('radio', { name: 'negativ' }) as HTMLInputElement).checked).toBe(true)
  })

  it('a factor tied to a group that is no longer a focus group stays visible and says so', () => {
    const p = project()
    p.steps[4].block.externalFactors = [makeItem(4, 'externalFactors', { groupId: 'tg3', text: 'Elternzeiten' }, { id: 'ef1' })]
    open(p)
    expect(within(row('ef1')).getByText('Gruppe ist keine Fokusgruppe mehr')).toBeTruthy()
    expect((within(row('ef1')).getByRole('combobox') as HTMLSelectElement).selectedOptions[0].textContent).toBe('„Eltern“ (keine Fokusgruppe mehr)')
  })

  it('outputs of a group that is no longer a focus group are hidden with a note', () => {
    const p = project()
    p.steps[1].block.targetGroups[1].isFocus = false
    p.steps[4].block.outputs.push(output('ou4', 'tg2', 1, 'Mädchen-Nachmittag'))
    open(p)
    expect(document.querySelector('[data-item-id="ou4"]')).toBeNull()
    expect(screen.getByText(/1 Leistung ist ausgeblendet, solange „Mädchen“ keine Fokusgruppe ist/)).toBeTruthy()
  })
})
