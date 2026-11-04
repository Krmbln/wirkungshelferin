import { act, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeProject, makeProjectWithStatuses } from '../../src/domain/fixtures'
import { projectSchema } from '../../src/domain/schemas/project'
import { keys } from '../../src/storage/store'
import { readyStore } from '../stores'
import { PageHeader, SAVED_VISIBLE_MS } from '../../src/ui/frame/PageHeader'
import { SecondTab } from '../../src/ui/screens/SecondTab'
import { Session } from '../../src/ui/Session'
import { dummyKey } from '../dummyKey'

const h1 = () => screen.getByRole('heading', { level: 1 })
const banner = () => screen.queryByText('Speichern hat nicht geklappt – speichere jetzt ein Backup.')

/** A Web Lock manager that says another tab already holds the lock. */
const takenLocks = { request: async (_n: string, _o: LockOptions, cb: (l: Lock | null) => unknown) => cb(null) } as unknown as LockManager

/** Another tab holds the lock until `closeOther()`. */
function otherTab() {
  let held = true
  const locks = {
    request: async (_n: string, _o: LockOptions, cb: (l: Lock | null) => unknown) => {
      if (held) return cb(null)
      held = true
      return cb({ name: 'tab', mode: 'exclusive' } as Lock)
    },
  } as unknown as LockManager
  return { locks, closeOther: () => (held = false) }
}

const secondTabHeading = 'Die Wirkungshelferin ist schon in einem anderen Tab offen'

/** A store whose writes fail while `failing` is true. */
function flakyStore(initial: Record<string, unknown> = {}) {
  const store = readyStore(initial)
  const ctl = { failing: true }
  const set = store.set
  store.set = (key, value) => (ctl.failing ? Promise.reject(new Error('QuotaExceededError')) : set(key, value))
  return { store, ctl }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Session: start', () => {
  it('shows the skeleton while loading, then the empty state with two equal options', async () => {
    render(<Session store={readyStore()} />)
    expect(screen.getByRole('status').textContent).toBe('Wird geladen …')
    expect(await screen.findByRole('heading', { level: 1, name: 'Willkommen bei der Wirkungshelferin' })).toBeTruthy()
    const options = [screen.getByRole('button', { name: 'Neu starten' }), screen.getByRole('button', { name: 'Backup laden' })]
    for (const button of options) expect(button.className).toContain('btn--secondary')
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('"Neu starten" saves a valid project right away and opens home', async () => {
    const user = userEvent.setup()
    const store = readyStore()
    render(<Session store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    expect(h1().textContent).toBe('Übersicht')
    expect(await screen.findByText('Gespeichert')).toBeTruthy()
    expect(projectSchema.safeParse(store.data.get(keys.project)).success).toBe(true)
  })

  it('a stored project opens home with its statuses', async () => {
    const store = readyStore({ [keys.project]: makeProjectWithStatuses({ 0: 'confirmed', 1: 'in_progress' }) })
    render(<Session store={store} />)
    await screen.findByRole('heading', { level: 1, name: 'Übersicht' })
    const nav = screen.getByRole('navigation', { name: 'Navigation' })
    expect(within(nav).getByRole('button', { name: '0 Projekt, bestätigt' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: '1 Gruppen, in Arbeit' })).toBeTruthy()
    // Loading is not a change: no write, no "Gespeichert".
    expect(screen.queryByText('Gespeichert')).toBeNull()
  })

  it('a second tab is refused and never reads the stored data', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const get = vi.spyOn(store, 'get')
    render(<Session store={store} locks={takenLocks} />)
    expect(await screen.findByRole('heading', { name: secondTabHeading })).toBeTruthy()
    expect(get).not.toHaveBeenCalled()
  })

  it('a second tab opens the app by itself when Lukas comes back after closing the other tab', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const tab = otherTab()
    render(<Session store={store} locks={tab.locks} />)
    await screen.findByRole('heading', { name: secondTabHeading })
    // Coming back while the other tab is still open changes nothing.
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(await screen.findByRole('heading', { name: secondTabHeading })).toBeTruthy()
    tab.closeOther()
    act(() => void window.dispatchEvent(new Event('focus')))
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
  })

  it('the other tab releases the lock a moment after this one is shown (closing a tab): it still opens', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const tab = otherTab()
    render(<Session store={store} locks={tab.locks} />)
    await screen.findByRole('heading', { name: secondTabHeading })
    // Chrome shows this tab first, the closing tab lets go of the lock ~100 ms later.
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    setTimeout(tab.closeOther, 100)
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' }, { timeout: 2000 })).toBeTruthy()
  })

  it('clicking into the already shown tab asks again too', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const tab = otherTab()
    render(<Session store={store} locks={tab.locks} />)
    await screen.findByRole('heading', { name: secondTabHeading })
    tab.closeOther()
    act(() => void document.dispatchEvent(new Event('pointerdown')))
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
  })

  it('under StrictMode (effects run twice) it reaches home and reads the store once', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const get = vi.spyOn(store, 'get')
    const browser = otherTab()
    browser.closeOther()
    render(
      <StrictMode>
        <Session store={store} locks={browser.locks} />
      </StrictMode>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    // Once per key: the project, the settings and the pre-migration copy.
    expect(get.mock.calls.map(([key]) => key).sort()).toEqual([keys.project, keys.preMigration(0), keys.settings].sort())
  })

  it('once the app is open, coming back to the tab does not load again', async () => {
    const user = userEvent.setup()
    const store = readyStore()
    render(<Session store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    act(() => void window.dispatchEvent(new Event('focus')))
    await act(() => new Promise((r) => setTimeout(r, 20)))
    expect(h1().textContent).toBe('Übersicht')
  })

  it('storage that cannot be read asks for a reload and writes nothing', async () => {
    const store = readyStore()
    store.get = () => Promise.reject(new Error('blocked'))
    const set = vi.spyOn(store, 'set')
    render(<Session store={store} />)
    expect(await screen.findByRole('heading', { name: 'Chrome lässt die Wirkungshelferin gerade nicht an ihre Daten' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Seite neu laden' })).toBeTruthy()
    expect(set).not.toHaveBeenCalled()
  })

  it('an unreadable document shows a plain message and stays untouched', async () => {
    const broken = { ...makeProject(), steps: 'kaputt' }
    const store = readyStore({ [keys.project]: broken })
    const set = vi.spyOn(store, 'set')
    render(<Session store={store} />)
    expect(await screen.findByRole('heading', { name: 'Deine Daten lassen sich nicht öffnen' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Daten als Datei sichern' })).toBeTruthy()
    expect(set).not.toHaveBeenCalled()
    expect(store.data.get(keys.project)).toEqual(broken)
  })

  it('a document from a newer version asks for a reload', async () => {
    render(<Session store={readyStore({ [keys.project]: { ...makeProject(), schemaVersion: 2 } })} />)
    expect(await screen.findByRole('heading', { name: 'Deine Daten stammen von einer neueren Version' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Seite neu laden' })).toBeTruthy()
  })
})

describe('Session: backup from the empty state', () => {
  const choose = async (text: string) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await userEvent.setup().upload(input, new File([text], 'backup.json', { type: 'application/json' }))
  }

  it('a valid backup becomes the project and is saved', async () => {
    const store = readyStore()
    const backup = makeProjectWithStatuses({ 0: 'confirmed' })
    render(<Session store={store} />)
    await screen.findByRole('button', { name: 'Backup laden' })
    await choose(JSON.stringify(backup))
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    expect(store.data.get(keys.project)).toEqual(backup)
  })

  it('an unusable file says so where it happened and changes nothing', async () => {
    const store = readyStore()
    render(<Session store={store} />)
    await screen.findByRole('button', { name: 'Backup laden' })
    await choose('{"kein":"backup"}')
    expect(await screen.findByText(/kein Backup der Wirkungshelferin/)).toBeTruthy()
    expect(store.data.has(keys.project)).toBe(false)
    expect(screen.getByRole('button', { name: 'Neu starten' })).toBeTruthy()
  })
})

describe('Session: save failure', () => {
  it('shows a persistent ⛔ banner that goes only after a save succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const { store, ctl } = flakyStore()
    render(<Session store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(banner()).toBeTruthy()
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Backup speichern' })).toBeTruthy()

    // Still there after navigating and after the "Gespeichert" time.
    await user.click(screen.getByRole('button', { name: 'Einstellungen' }))
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(banner()).toBeTruthy()

    // The tab is hidden → flush → this time it works.
    ctl.failing = false
    hideTab()
    expect(await screen.findByText('Gespeichert')).toBeTruthy()
    expect(banner()).toBeNull()
    expect(store.data.has(keys.project)).toBe(true)
  })

  it('"Backup speichern" in the banner downloads the project', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    render(<Session store={flakyStore().store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Backup speichern' }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('Backup ist in deinen Downloads.')
  })
})

describe('Session: go on with a backup when the data is unreadable', () => {
  const broken = { ...makeProject(), steps: 'kaputt' }

  async function pickBackup(text: string) {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    expect(screen.queryByRole('button', { name: 'Mit einem Backup weitermachen' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Daten als Datei sichern' }))
    expect(screen.getByText('Gesichert in deinen Downloads.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mit einem Backup weitermachen' })).toBeTruthy()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, new File([text], 'backup.json', { type: 'application/json' }))
    return user
  }

  it('replaces the data only after the confirm dialog', async () => {
    const store = readyStore({ [keys.project]: broken })
    const backup = makeProjectWithStatuses({ 0: 'confirmed' })
    render(<Session store={store} />)
    const user = await pickBackup(JSON.stringify(backup))
    const dialog = await screen.findByRole('dialog', { name: 'Mit dem Backup weitermachen?' })
    expect(store.data.get(keys.project)).toEqual(broken)
    await user.click(within(dialog).getByRole('button', { name: 'Backup laden' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    expect(store.data.get(keys.project)).toEqual(backup)
  })

  // Found in step 7: settings were loaded only after a readable project, so continuing from
  // here ran with the defaults (no key, setup again) and the next change overwrote the key.
  it('continuing with a backup keeps the stored settings (key, setup done)', async () => {
    const settings = { apiKey: dummyKey, model: 'claude-sonnet-5-5', effort: 'high', setupDone: true }
    const store = readyStore({ [keys.project]: broken, [keys.settings]: settings })
    render(<Session store={store} />)
    const user = await pickBackup(JSON.stringify(makeProject()))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Backup laden' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Einstellungen' }))
    expect(screen.getByText('••••••••c3AA')).toBeTruthy()
    expect((screen.getByLabelText('Modell') as HTMLInputElement).value).toBe('claude-sonnet-5-5')
  })

  it('"Abbrechen" changes nothing', async () => {
    const store = readyStore({ [keys.project]: broken })
    render(<Session store={store} />)
    const user = await pickBackup(JSON.stringify(makeProject()))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abbrechen' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Deine Daten lassen sich nicht öffnen' })).toBeTruthy()
    expect(store.data.get(keys.project)).toEqual(broken)
  })

  it('an unusable file says so and changes nothing', async () => {
    const store = readyStore({ [keys.project]: broken })
    render(<Session store={store} />)
    await pickBackup('kein json')
    expect(await screen.findByText(/kein Backup der Wirkungshelferin/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.data.get(keys.project)).toEqual(broken)
  })
})

describe('Saving: flush when the tab is hidden', () => {
  /** Start a project while saving fails, so a document stays pending. */
  async function pendingProject() {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = userEvent.setup()
    const flaky = flakyStore()
    const view = render(<Session store={flaky.store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    await screen.findByRole('alert')
    flaky.ctl.failing = false
    return { ...flaky, view }
  }

  it('pagehide saves the pending document', async () => {
    const { store } = await pendingProject()
    act(() => void window.dispatchEvent(new Event('pagehide')))
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(store.data.has(keys.project)).toBe(true)
  })

  it('ending the session (unmount) saves the pending document', async () => {
    const { store, view } = await pendingProject()
    view.unmount()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.data.has(keys.project)).toBe(true)
  })

  // The flush that does save is covered above (failed save → hidden tab → saved).
  it('hiding the tab with nothing pending writes nothing', async () => {
    const user = userEvent.setup()
    const store = readyStore()
    render(<Session store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    await screen.findByText('Gespeichert')
    const set = vi.spyOn(store, 'set')
    hideTab()
    expect(set).not.toHaveBeenCalled()
  })
})

describe('"Gespeichert"', () => {
  it('shows muted for 2 s after each save, then disappears', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<PageHeader title="Übersicht" savedAt={1} />)
      const slot = document.querySelector('[data-slot="saved"]')!
      expect(slot.textContent).toBe('Gespeichert')
      act(() => vi.advanceTimersByTime(SAVED_VISIBLE_MS - 1))
      expect(slot.textContent).toBe('Gespeichert')
      act(() => vi.advanceTimersByTime(1))
      expect(slot.textContent).toBe('')
      rerender(<PageHeader title="Übersicht" savedAt={2} />)
      expect(slot.textContent).toBe('Gespeichert')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows nothing before the first save', () => {
    render(<PageHeader title="Übersicht" />)
    expect(document.querySelector('[data-slot="saved"]')!.textContent).toBe('')
  })
})

describe('Second tab screen', () => {
  it('says how to close the tab when Chrome refuses to close it', async () => {
    const user = userEvent.setup()
    render(<SecondTab closeTab={async () => false} />)
    expect(screen.queryByText(/Cmd\+W/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Diesen Tab schließen' }))
    expect(screen.getByText('Chrome lässt diesen Tab nicht von hier aus schließen – drück Cmd+W.')).toBeTruthy()
  })
})

function hideTab() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
}

