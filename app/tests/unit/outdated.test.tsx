import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { earlierChanges, type EarlierChange } from '../../src/domain/outdated'
import { reducer, type Action } from '../../src/domain/reducer'
import type { Project } from '../../src/domain/schemas/project'
import type { StepId } from '../../src/domain/types'
import { App } from '../../src/ui/App'
import { OutdatedBanner } from '../../src/ui/check/OutdatedBanner'
import type { ChatControls } from '../../src/ui/chat/useChatRunner'
import { steps } from '../../src/ui/steps'
import { AT, editCause, outdatedProject, reconfirm } from '../outdated'

// Change handling in the UI (implementation plan step 21, design §6.2 "Step 21").

const NOW = new Date('2026-11-10T15:00:00.000Z')
const marked = () => reconfirm(outdatedProject(), 2, [editCause('Kein Werkzeug und kein Raum')])
const h1 = () => screen.getByRole('heading', { level: 1 })
const banner = () => document.querySelector<HTMLElement>('.outdated')!

/** The App with the reducer behind it, like Session (without storage and AI). */
function Live({ start, step, chat }: { start: Project; step: StepId; chat?: ChatControls }) {
  const [project, setProject] = useState(start)
  return <App project={project} now={NOW} initialView={{ kind: 'step', step }} chat={chat} onBlockAction={(a: Action) => setProject((p) => reducer(p, a))} />
}

const fakeChat = (runs: ChatControls['runs'] = {}): ChatControls => ({ runs, send: vi.fn(), act: vi.fn(), stop: vi.fn(), retry: vi.fn() })

describe('outdated step', () => {
  it('shows the banner above the block, as no live region; the step link opens step 2', async () => {
    const user = userEvent.setup()
    render(<Live start={marked()} step={4} />)
    const b = banner()
    expect(b.closest('.workspace__block')).toBeTruthy()
    expect(b.closest('.workspace__scroll')).toBeNull()
    expect(b.textContent).toContain('Schritt 2 hat sich geändert, seit du diesen Schritt bestätigt hast. Vielleicht passt hier etwas nicht mehr.')
    expect(b.querySelector('[role="status"].banner, [role="alert"]')).toBeNull()
    expect(b.querySelector('.banner')!.getAttribute('role')).toBeNull()
    await user.click(within(b).getByRole('button', { name: 'Zu Schritt 2' }))
    expect(h1().textContent).toBe(steps[2].title)
    expect(banner()).toBeNull()
  })

  it('"Änderung prüfen lassen" sends the review turn of this step', async () => {
    const user = userEvent.setup()
    const chat = fakeChat()
    render(<Live start={marked()} step={4} chat={chat} />)
    await user.click(within(banner()).getByRole('button', { name: 'Änderung prüfen lassen' }))
    expect(chat.act).toHaveBeenCalledWith(4, { kind: 'review' })
  })

  it('editing keeps the banner and the ⚠; a confirmed step has none', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Live start={marked()} step={3} />)
    expect(banner()).toBeTruthy()
    // Step 3's block is empty: add a goal row by hand.
    const add = document.querySelector<HTMLElement>('[data-add]')!
    await user.click(add)
    expect(banner()).toBeTruthy()
    expect(screen.getByRole('button', { name: /^3 .*vielleicht veraltet$/ })).toBeTruthy()
    unmount()
    render(<Live start={marked()} step={2} />)
    expect(banner()).toBeNull()
  })

  it('sidebar and home follow the stored status', () => {
    render(<App project={marked()} now={NOW} />)
    for (const s of [3, 4, 5, 6]) expect(screen.getByRole('button', { name: new RegExp(`^${s} .*, vielleicht veraltet$`) })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^2 .*, bestätigt$/ })).toBeTruthy()
    expect(screen.getAllByText('vielleicht veraltet – prüfen')).toHaveLength(4)
  })

  it('the gate of an unchanged outdated step says since when and offers the confirm', async () => {
    const user = userEvent.setup()
    const p = marked()
    p.steps[4].qualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[4].block), results: [] }
    render(<Live start={p} step={4} />)
    expect(screen.getByText('Bestätigt am 03.11. – seitdem hat sich Schritt 2 geändert.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))
    expect(banner()).toBeNull()
    expect(screen.getByRole('button', { name: /^4 .*, bestätigt$/ })).toBeTruthy()
  })

  it('while an answer runs in the step, Bestätigen waits with the reason (the answer may bring a card)', () => {
    const p = marked()
    p.steps[4].qualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[4].block), results: [] }
    render(<Live start={p} step={4} chat={fakeChat({ 4: { kind: 'running', blocks: [] } })} />)
    const gate = screen.getByRole('region', { name: 'Qualitätscheck' })
    expect(within(gate).getByRole('button', { name: 'Bestätigen' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(gate).getByText('Warte, bis die Antwort im Chat fertig ist.')).toBeTruthy()
  })

  it('⚠ points confirmed anyway keep "· trotzdem bestätigt" while the block is unchanged', async () => {
    const user = userEvent.setup()
    const p = marked()
    p.steps[4].confirmedWarnings = ['2']
    p.steps[4].qualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[4].block), results: [{ criterion: '2', result: 'warn', note: 'Annahmen dünn.' }] }
    render(<Live start={p} step={4} />)
    expect(screen.getByText(/trotzdem bestätigt/)).toBeTruthy()
    // An edit ends it: the block is no longer what was confirmed.
    await user.click(document.querySelector<HTMLElement>('[data-add]')!)
    expect(screen.queryByText(/trotzdem bestätigt/)).toBeNull()
  })
})

describe('later steps read an outdated step as confirmed', () => {
  it('no "noch nicht bestätigt" note for an outdated earlier step (found in the step 21 gallery)', () => {
    const { unmount } = render(<App project={marked()} now={NOW} initialView={{ kind: 'step', step: 4 }} />)
    expect(screen.queryByText(/noch nicht bestätigt/)).toBeNull()
    unmount()
    const open = marked()
    open.steps[3].status = 'in_progress'
    render(<App project={open} now={NOW} initialView={{ kind: 'step', step: 4 }} />)
    expect(screen.getByText('Schritt 3 ist noch nicht bestätigt – die Ziele können sich noch ändern.')).toBeTruthy()
  })
})

describe('re-confirming the changed step', () => {
  it('marks steps 3–6, names them under "Bestätigt" and tells a screen reader (the plan\'s test)', async () => {
    const user = userEvent.setup()
    const p = reducer(outdatedProject({ 5: 'in_progress' }), editCause('Kein Werkzeug und kein Raum'))
    p.steps[2].qualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[2].block), results: [] }
    render(<Live start={p} step={2} />)
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))
    expect(screen.getByText('Darauf bauen Schritt 3, 4 und 6 auf – sie sind jetzt als „vielleicht veraltet“ markiert.')).toBeTruthy()
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'Bestätigt. Schritt 3, 4 und 6 sind jetzt als „vielleicht veraltet“ markiert.')).toBe(true)
    for (const s of [3, 4, 6]) expect(screen.getByRole('button', { name: new RegExp(`^${s} .*, vielleicht veraltet$`) })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^5 .*, in Arbeit$/ })).toBeTruthy()
  })

  it('a re-confirm that changed nothing announces nothing, although steps are still outdated from before', async () => {
    const user = userEvent.setup()
    const p = reducer(marked(), editCause('Anders'))
    const back = reducer(p, editCause('Kein Werkzeug und kein Raum'))
    back.steps[2].qualityCheck = { at: AT, source: 'app', block: structuredClone(back.steps[2].block), results: [] }
    render(<Live start={back} step={2} />)
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))
    expect(screen.getByText(/^Darauf bauen Schritt 3, 4, 5 und 6 auf/)).toBeTruthy()
    expect(screen.getAllByRole('status').some((s) => /markiert/.test(s.textContent ?? ''))).toBe(false)
  })

  it('one step left: "Darauf baut Schritt 6 auf – er ist …"; nothing marked: no line', () => {
    const p = marked()
    for (const s of [3, 4, 5] as const) {
      p.steps[s].status = 'confirmed'
      delete p.steps[s].outdatedBy
    }
    const { unmount } = render(<App project={p} now={NOW} initialView={{ kind: 'step', step: 2 }} />)
    expect(screen.getByText('Darauf baut Schritt 6 auf – er ist jetzt als „vielleicht veraltet“ markiert.')).toBeTruthy()
    unmount()
    render(<App project={outdatedProject()} now={NOW} initialView={{ kind: 'step', step: 2 }} />)
    expect(screen.queryByText(/Darauf bau/)).toBeNull()
  })
})

describe('OutdatedBanner', () => {
  const change = (step: StepId, frameOnly = false) => ({ ...earlierChanges(marked(), 4)[0], step, frameOnly }) as EarlierChange
  const props = { reviewed: false, running: false, chatBusy: false, onReview: () => {}, onOpenStep: () => {} }

  it('words one step, several, the frame alone and the frame with another step', () => {
    const text = (changes: EarlierChange[]) => {
      const { container, unmount } = render(<OutdatedBanner {...props} changes={changes} />)
      const t = container.querySelector('.banner__text')!.textContent!.replace(/Änderung prüfen lassen.*$/, '')
      unmount()
      return t
    }
    expect(text([change(0), change(2)])).toBe('Schritt 0 und Schritt 2 haben sich geändert, seit du diesen Schritt bestätigt hast. Vielleicht passt hier etwas nicht mehr.')
    expect(text([change(0), change(1), change(2)])).toMatch(/^Schritt 0, Schritt 1 und Schritt 2 haben sich geändert/)
    expect(text([change(0, true)])).toMatch(/^Der Messrahmen in Schritt 0 hat sich geändert/)
    expect(text([change(0, true), change(2)])).toMatch(/^Schritt 0 \(Messrahmen\) und Schritt 2 haben sich geändert/)
  })

  it('busy while its turn runs; disabled with the reason while another answer runs', () => {
    const { rerender } = render(<OutdatedBanner {...props} changes={[change(2)]} running chatBusy />)
    const button = screen.getByRole('button', { name: 'prüft die Änderung …' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    rerender(<OutdatedBanner {...props} changes={[change(2)]} chatBusy />)
    expect(screen.getByText('Warte, bis die Antwort im Chat fertig ist.')).toBeTruthy()
  })

  it('the announcement also lands under StrictMode (no ref written during render)', () => {
    const { rerender } = render(<StrictMode><OutdatedBanner {...props} changes={[change(2)]} running chatBusy /></StrictMode>)
    rerender(<StrictMode><OutdatedBanner {...props} changes={[change(2)]} reviewed /></StrictMode>)
    expect(screen.getByRole('status').textContent).toBe('Geprüft – die Antwort steht im Chat.')
  })

  it('after the check: new text, the same button (focus stays) as "Nochmal prüfen lassen", announced once', () => {
    const { rerender } = render(<OutdatedBanner {...props} changes={[change(2)]} running chatBusy />)
    const button = screen.getAllByRole('button').find((b) => b.classList.contains('outdated__review'))!
    act(() => button.focus())
    rerender(<OutdatedBanner {...props} changes={[change(2)]} reviewed />)
    expect(document.activeElement).toBe(button)
    expect(button.textContent).toContain('Nochmal prüfen lassen')
    expect(button.classList.contains('btn--text')).toBe(true)
    expect(banner().textContent).toContain('Die Antwort der Wirkungshelferin steht im Chat. Passt alles, bestätige unten erneut.')
    expect(screen.getByRole('status').textContent).toBe('Geprüft – die Antwort steht im Chat.')
  })
})
