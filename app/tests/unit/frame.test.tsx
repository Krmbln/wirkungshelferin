import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FIXTURE_TIME, makeProject, makeProjectWithStatuses } from '../../src/domain/fixtures'
import { App } from '../../src/ui/App'
import { guideFiles } from '../../src/guide'
import { guideTitle, recommendedStep, statusesOf, steps } from '../../src/ui/steps'

const mixedProject = makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'maybe_outdated', 3: 'in_progress' })
const mixed = statusesOf(mixedProject)
const fresh = makeProject()

const nav = () => screen.getByRole('navigation', { name: 'Navigation' })
const h1 = () => screen.getByRole('heading', { level: 1 })
const current = () => within(nav()).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page')
const stepRow = (n: number) => within(nav()).getByRole('button', { name: new RegExp(`^${n} `) })

describe('steps', () => {
  it('has steps 0–6 with titles from the guide headings', () => {
    expect(steps.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(steps[1].title).toBe('Herausforderung, Zielgruppen & Beteiligte')
    expect(steps.map((s) => s.part)).toEqual([
      'Kontext',
      'Strategie',
      'Strategie',
      'Strategie',
      'Strategie',
      'Analyse',
      'Analyse',
    ])
  })

  it('refuses a guide file whose heading has the wrong step number', () => {
    expect(() => guideTitle(guideFiles['step-2-problem.md'], 3)).toThrow()
  })

  it('recommends the first step that is not confirmed', () => {
    expect(recommendedStep(mixed)).toBe(2)
    expect(recommendedStep({ ...mixed, 2: 'done', 3: 'done', 4: 'done', 5: 'done', 6: 'done' })).toBeNull()
  })
})

describe('navigation', () => {
  it('starts at home with exactly one primary button', () => {
    const { container } = render(<App project={fresh} />)
    expect(h1().textContent).toBe('Übersicht')
    expect(current().map((b) => b.textContent)).toEqual(['Übersicht'])
    expect(container.querySelectorAll('.btn--primary')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeTruthy()
    expect(screen.getByText('Hier fängst du an')).toBeTruthy()
  })

  it('goes home → step → step → settings → home', async () => {
    const user = userEvent.setup()
    render(<App project={fresh} />)

    await user.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(h1().textContent).toBe('Projektkontext & Messrahmen')
    expect(screen.getByText('Schritt 0 · Kontext')).toBeTruthy()
    expect(current()).toEqual([stepRow(0)])
    expect(screen.getByRole('region', { name: 'Chat' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Baustein' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Qualitätscheck' })).toBeTruthy()
    // "Weiter" is gone, so focus moves to the new page title instead of <body>.
    expect(document.activeElement).toBe(h1())

    await user.click(stepRow(4))
    expect(h1().textContent).toBe('Wirkungslogik')
    expect(screen.getByText('Schritt 4 · Strategie')).toBeTruthy()
    expect(document.title).toBe('Wirkungslogik – Wirkungshelferin')
    // A sidebar row keeps focus.
    expect(document.activeElement).toBe(stepRow(4))

    await user.click(within(nav()).getByRole('button', { name: 'Einstellungen' }))
    expect(h1().textContent).toBe('Einstellungen')
    expect(current().map((b) => b.textContent)).toEqual(['Einstellungen'])

    await user.click(within(nav()).getByRole('button', { name: 'Übersicht' }))
    expect(h1().textContent).toBe('Übersicht')
    expect(document.title).toBe('Wirkungshelferin')
  })

  it('opens a step from its home row', async () => {
    const user = userEvent.setup()
    render(<App project={fresh} />)
    await user.click(screen.getByRole('button', { name: /^5 · Messfokus & Indikatoren/ }))
    expect(h1().textContent).toBe('Messfokus & Indikatoren')
    expect(screen.getByText('Schritt 5 · Analyse')).toBeTruthy()
  })

  it('shows the narrow-window hint text (CSS shows it below 960 px)', () => {
    render(<App project={fresh} />)
    expect(screen.getByText(/Zieh das Fenster etwas breiter/)).toBeTruthy()
  })
})

describe('status icons', () => {
  const labels: Record<string, string> = {
    todo: 'noch nicht begonnen',
    progress: 'in Arbeit',
    done: 'bestätigt',
    stale: 'vielleicht veraltet',
  }

  it('maps every sidebar row to its status icon and accessible name', () => {
    render(<App project={mixedProject} />)
    for (const step of steps) {
      const row = stepRow(step.id)
      const label = labels[mixed[step.id]]
      expect(within(row).getByRole('img').getAttribute('aria-label')).toBe(label)
      expect(row.getAttribute('aria-label')).toBe(`${step.id} ${step.short}, ${label}`)
    }
  })

  it('home rows show the status as words and mark the recommended step', () => {
    render(<App project={mixedProject} />)
    const row = screen.getByRole('button', { name: /^2 · Problem & Ursachen/ })
    expect(row.textContent).toContain('vielleicht veraltet – prüfen')
    expect(row.textContent).toContain('Empfohlen als Nächstes')
    expect(screen.getAllByText('Empfohlen als Nächstes')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Schritt 2 · Problem & Ursachen' })).toBeTruthy()
    expect(screen.getByText('Als Nächstes')).toBeTruthy()
  })
})

describe('keyboard', () => {
  it('Tab follows reading order: sidebar, then the page', async () => {
    const user = userEvent.setup()
    // Clock pinned: more than 7 days after the fixture's creation the backup reminder adds a button.
    render(<App project={fresh} now={new Date(FIXTURE_TIME)} />)
    const names: string[] = []
    for (let i = 0; i < 11; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      names.push(el.getAttribute('aria-label') ?? el.textContent ?? '')
    }
    expect(names).toEqual([
      'Übersicht',
      ...steps.map((s) => `${s.id} ${s.short}, noch nicht begonnen`),
      'Einstellungen',
      'Weiter',
      expect.stringMatching(/^0 · Projektkontext/),
    ])
  })

  it('a sidebar row shows its status tooltip on hover, beside the row', async () => {
    const user = userEvent.setup()
    render(<App project={mixedProject} />)
    const bubble = within(stepRow(5)).getByRole('tooltip', { hidden: true })
    await user.hover(stepRow(5))
    expect(bubble.hidden).toBe(false)
    expect(bubble.closest('.tooltip--right')).toBeTruthy()
    await user.unhover(stepRow(5))
    expect(bubble.hidden).toBe(true)
  })

  it('a sidebar row shows its status tooltip on keyboard focus, not on click; Esc hides it', async () => {
    const user = userEvent.setup()
    render(<App project={mixedProject} />)
    const bubble = (n: number) => within(stepRow(n)).getByRole('tooltip', { hidden: true })

    await user.click(stepRow(2))
    await user.unhover(stepRow(2))
    expect(bubble(2).hidden).toBe(true)

    await user.tab()
    expect(document.activeElement).toBe(stepRow(3))
    expect(bubble(3).hidden).toBe(false)
    expect(bubble(3).textContent).toBe('in Arbeit')
    expect(bubble(3).getAttribute('aria-hidden')).toBe('true')

    await user.keyboard('{Escape}')
    expect(bubble(3).hidden).toBe(true)

    await user.tab()
    expect(bubble(3).hidden).toBe(true)
    expect(bubble(4).hidden).toBe(false)
  })
})
