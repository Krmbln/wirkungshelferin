import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import type { Project } from '../../src/domain/schemas/project'
import { step6Project } from '../../src/gallery/step6Screens'
import { App } from '../../src/ui/App'
import { COPIED_MS, CopyButton } from '../../src/ui/copy/CopyButton'
import type { ClipboardLike } from '../../src/ui/copy/clipboard'
import { copyAll, copyStep } from '../../src/ui/copy/model'
import { AT, outdatedProject } from '../outdated'

// Copy buttons (implementation plan step 23, design §6.5): "Kopieren" per block, "Alles kopieren"
// on Home and after the last confirm, the feedback, the plain-text fallback and the failure line.

const NOW = new Date('2026-11-10T12:00:00')

/** jsdom has no ClipboardItem: a stand-in that keeps what it was given. */
class FakeItem {
  constructor(readonly parts: Record<string, Blob>) {}
}

type Fake = ClipboardLike & { items: FakeItem[]; texts: string[] }

function fakeClipboard({ refuseRich = false, refusePlain = false } = {}): Fake {
  const fake: Fake = {
    items: [],
    texts: [],
    write: vi.fn(async (items: ClipboardItems) => {
      if (refuseRich) throw new DOMException('denied', 'NotAllowedError')
      fake.items.push(...(items as unknown as FakeItem[]))
    }),
    writeText: vi.fn(async (text: string) => {
      if (refusePlain) throw new DOMException('denied', 'NotAllowedError')
      fake.texts.push(text)
    }),
  }
  return fake
}

/** user-event installs its own clipboard on setup(): ours goes in afterwards. */
function useClipboard(fake: Fake) {
  Object.defineProperty(navigator, 'clipboard', { value: fake, configurable: true })
}

const htmlOf = async (fake: Fake) => (await fake.items.at(-1)!.parts['text/html'].text()) as string
const textOf = async (fake: Fake) => (await fake.items.at(-1)!.parts['text/plain'].text()) as string

beforeEach(() => vi.stubGlobal('ClipboardItem', FakeItem))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CopyButton', () => {
  const copied = { html: '<html><body><h1>T</h1></body></html>', text: 'T' }

  it('writes HTML and plain text together, says "Kopiert" for 2 s at the same element, announces it', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fake = fakeClipboard()
    render(<CopyButton build={() => copied} clipboard={fake}>Alles kopieren</CopyButton>)
    const button = screen.getByRole('button', { name: 'Alles kopieren' })
    await user.click(button)
    expect(await htmlOf(fake)).toBe(copied.html)
    expect(await textOf(fake)).toBe('T')
    expect(fake.writeText).not.toHaveBeenCalled()
    expect(button.getAttribute('data-copied')).toBe('true')
    expect(within(button).getByText('Kopiert').getAttribute('aria-hidden')).toBeNull()
    expect(within(button).getByText('Alles kopieren').getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(button)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Kopiert. Du kannst den Text jetzt in Google Docs oder Word einfügen.')
    act(() => void vi.advanceTimersByTime(COPIED_MS))
    expect(button.getAttribute('data-copied')).toBeNull()
    // A second copy is announced again: the text changes.
    await user.click(button)
    expect(status.textContent).not.toBe('Kopiert. Du kannst den Text jetzt in Google Docs oder Word einfügen.')
    expect(status.textContent!.trim()).toBe('Kopiert. Du kannst den Text jetzt in Google Docs oder Word einfügen.')
  })

  it('builds the copy at click time', async () => {
    const user = userEvent.setup()
    const fake = fakeClipboard()
    let n = 0
    render(<CopyButton build={() => ({ html: `<p>${++n}</p>`, text: `${n}` })} clipboard={fake}>Kopieren</CopyButton>)
    expect(n).toBe(0)
    await user.click(screen.getByRole('button'))
    expect(await textOf(fake)).toBe('1')
  })

  it('falls back to plain text and says so under the button', async () => {
    const user = userEvent.setup()
    const fake = fakeClipboard({ refuseRich: true })
    render(<CopyButton build={() => copied} clipboard={fake}>Kopieren</CopyButton>)
    await user.click(screen.getByRole('button'))
    expect(fake.texts).toEqual(['T'])
    expect(screen.getByRole('button').getAttribute('data-copied')).toBe('true')
    expect(screen.getByText('Ohne Formatierung kopiert – Überschriften musst du beim Einfügen vielleicht selbst setzen.')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Ohne Formatierung kopiert. Du kannst den Text jetzt einfügen.')
  })

  it('shows ⛔ only when both are refused, and clears it after the next success', async () => {
    const user = userEvent.setup()
    const refused = fakeClipboard({ refuseRich: true, refusePlain: true })
    const { rerender } = render(<CopyButton build={() => copied} clipboard={refused}>Kopieren</CopyButton>)
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('Kopieren hat nicht geklappt. Versuch es gleich noch einmal.')).toBeTruthy()
    expect(screen.getByRole('button').getAttribute('data-copied')).toBeNull()
    rerender(<CopyButton build={() => copied} clipboard={fakeClipboard()}>Kopieren</CopyButton>)
    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('Kopieren hat nicht geklappt. Versuch es gleich noch einmal.')).toBeNull()
  })

  it('a failure right after a copy takes "Kopiert" back', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CopyButton build={() => copied} clipboard={fakeClipboard()}>Kopieren</CopyButton>)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('data-copied')).toBe('true')
    rerender(<CopyButton build={() => copied} clipboard={fakeClipboard({ refuseRich: true, refusePlain: true })}>Kopieren</CopyButton>)
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('data-copied')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
    expect(screen.getByText('Kopieren hat nicht geklappt. Versuch es gleich noch einmal.')).toBeTruthy()
  })

  it('without ClipboardItem it copies plain text', async () => {
    vi.unstubAllGlobals()
    const user = userEvent.setup()
    const fake = fakeClipboard()
    render(<CopyButton build={() => copied} clipboard={fake}>Kopieren</CopyButton>)
    await user.click(screen.getByRole('button'))
    expect(fake.texts).toEqual(['T'])
  })
})

let latest: Project
function Harness({ initial, step }: { initial: Project; step?: number }) {
  const [p, setP] = useState(initial)
  latest = p
  return (
    <App
      project={p}
      now={NOW}
      initialView={step === undefined ? { kind: 'home' } : { kind: 'step', step: step as 0 }}
      onBlockAction={(a) => setP((x) => reducer(x, a))}
    />
  )
}

const panel = () => screen.getByRole('region', { name: 'Baustein' })

describe('"Kopieren" per block', () => {
  it('sits on the Baustein heading line and copies that block', async () => {
    const user = userEvent.setup()
    const fake = fakeClipboard()
    useClipboard(fake)
    render(<Harness initial={step6Project()} step={4} />)
    const button = within(panel()).getByRole('button', { name: 'Baustein kopieren: Schritt 4 · Wirkungslogik' })
    expect(button.closest('.workspace__head')?.querySelector('h2')?.textContent).toBe('Baustein')
    await user.click(button)
    expect(await textOf(fake)).toBe(copyStep(latest, 4).text)
    expect(await htmlOf(fake)).toBe(copyStep(latest, 4).html)
  })

  it('is hidden while the block holds nothing to copy', () => {
    render(<Harness initial={makeProject()} step={1} />)
    expect(within(panel()).queryByRole('button', { name: /^Baustein kopieren/ })).toBeNull()
  })

  it('a field still being edited is in the copy (its save runs before the click)', async () => {
    const user = userEvent.setup()
    const p = makeProject()
    p.steps[1].block.challenge = makeItem(1, 'challenge', { text: 'Alter Satz', why: '' })
    render(<Harness initial={p} step={1} />)
    const fake = fakeClipboard()
    useClipboard(fake)
    const field = within(panel()).getByRole('textbox', { name: 'Herausforderung' })
    await user.click(field)
    await user.clear(field)
    await user.type(field, 'Neuer Satz, eben getippt')
    await user.click(within(panel()).getByRole('button', { name: /^Baustein kopieren/ }))
    expect(await textOf(fake)).toContain('Neuer Satz, eben getippt')
    expect(await textOf(fake)).not.toContain('Alter Satz')
  })
})

describe('"Alles kopieren" on Home', () => {
  it('the Ergebnis section copies the whole model and names steps not confirmed', async () => {
    const user = userEvent.setup()
    const fake = fakeClipboard()
    useClipboard(fake)
    const p = step6Project()
    render(<Harness initial={p} />)
    const section = screen.getByRole('region', { name: 'Ergebnis' })
    expect(within(section).getByText('Alle Bausteine mit ihren Begründungen als Text – zum Einfügen in Google Docs oder Word.')).toBeTruthy()
    expect(within(section).getByText('Noch nicht bestätigt: Schritt 6 – er wird so kopiert, wie er gerade ist.')).toBeTruthy()
    await user.click(within(section).getByRole('button', { name: 'Alles kopieren' }))
    expect(await textOf(fake)).toBe(copyAll(p, NOW).text)
    // Still one primary on the page: Weiter.
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1)
  })

  it('is disabled with its reason while nothing is filled', () => {
    render(<Harness initial={makeProject()} />)
    const button = within(screen.getByRole('region', { name: 'Ergebnis' })).getByRole('button', { name: 'Alles kopieren' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Noch nichts zu kopieren – fang mit Schritt 0 an.')).toBeTruthy()
    expect(screen.queryByText(/Noch nicht bestätigt:/)).toBeNull()
  })

  it('with every step confirmed it is the card’s primary, and the Ergebnis section goes', async () => {
    const user = userEvent.setup()
    const fake = fakeClipboard()
    useClipboard(fake)
    const p = step6Project()
    for (const s of [0, 1, 2, 3, 4, 5, 6] as const) p.steps[s].status = 'confirmed'
    render(<Harness initial={p} />)
    expect(screen.getByText('Dein Wirkungsmodell ist fertig. Kopier es und füg es in Google Docs oder Word ein.')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Alles kopieren' })
    expect(button.className).toContain('btn--primary')
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Ergebnis' })).toBeNull()
    await user.click(button)
    expect(await textOf(fake)).toBe(copyAll(p, NOW).text)
  })
})

describe('after confirming step 6', () => {
  function ready(step: 4 | 6): Project {
    const p = outdatedProject({ [step]: 'in_progress' })
    p.steps[step].qualityCheck = { at: AT, source: 'app', block: structuredClone(p.steps[step].block) as never, results: [] }
    return p
  }

  it('the banner reminds of the backup and "Alles kopieren"; after the backup the copy stays', async () => {
    const user = userEvent.setup()
    const onSaveBackup = vi.fn()
    const p = ready(6)
    function Live() {
      const [project, setP] = useState(p)
      latest = project
      return <App project={project} now={NOW} initialView={{ kind: 'step', step: 6 }} onSaveBackup={onSaveBackup} onBlockAction={(a) => setP((x) => reducer(x, a))} />
    }
    render(<Live />)
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))
    const gate = screen.getByRole('region', { name: 'Qualitätscheck' })
    expect(within(gate).getByText('Schritt bestätigt. Speichere jetzt ein Backup und kopier dein Ergebnis.')).toBeTruthy()
    expect(document.activeElement).toBe(within(gate).getByRole('button', { name: 'Backup speichern' }))
    expect(within(gate).getByRole('button', { name: 'Später' })).toBeTruthy()
    await user.click(within(gate).getByRole('button', { name: 'Backup speichern' }))
    expect(onSaveBackup).toHaveBeenCalledOnce()
    expect(within(gate).queryByRole('button', { name: 'Backup speichern' })).toBeNull()
    expect(document.activeElement).toBe(within(gate).getByText('Backup ist in deinen Downloads.'))
    const fake = fakeClipboard()
    useClipboard(fake)
    await user.click(within(gate).getByRole('button', { name: 'Alles kopieren' }))
    expect(await textOf(fake)).toBe(copyAll(latest, NOW).text)
    await user.click(within(gate).getByRole('button', { name: 'Später' }))
    expect(within(gate).queryByRole('button', { name: 'Alles kopieren' })).toBeNull()
  })

  it('steps 0–5 keep their backup question', async () => {
    const user = userEvent.setup()
    const p = ready(4)
    function Live() {
      const [project, setP] = useState(p)
      return <App project={project} now={NOW} initialView={{ kind: 'step', step: 4 }} onBlockAction={(a) => setP((x) => reducer(x, a))} />
    }
    render(<Live />)
    await user.click(screen.getByRole('button', { name: 'Bestätigen' }))
    const gate = screen.getByRole('region', { name: 'Qualitätscheck' })
    expect(within(gate).getByText('Schritt bestätigt. Jetzt Backup speichern?')).toBeTruthy()
    expect(within(gate).queryByRole('button', { name: 'Alles kopieren' })).toBeNull()
  })
})
