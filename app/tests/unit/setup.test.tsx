import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionResult } from '../../src/ai/client'
import { scriptedAiClient } from '../../src/ai/mock'
import { makeProject } from '../../src/domain/fixtures'
import type { Project } from '../../src/domain/schemas/project'
import { defaultSettings } from '../../src/storage/settings'
import { keys, memoryStore } from '../../src/storage/store'
import { Session } from '../../src/ui/Session'
import { setupPlan } from '../../src/ui/setup/plan'
import { dummyKey } from '../dummyKey'
import { readyStore } from '../stores'

// Step 7: first-start setup (design §6.3) and the connection test, through the real Session
// with an in-memory store and the scripted AiClient.

let downloads: Promise<string>[] = []

beforeEach(() => {
  downloads = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloads.push(blob.text())
    return 'blob:x'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  // jsdom has no StorageManager; some tests add one.
  Reflect.deleteProperty(navigator, 'storage')
})

const h1 = () => screen.getByRole('heading', { level: 1 }).textContent
const next = (name: 'Weiter' | 'Fertig' = 'Weiter') => screen.getByRole('button', { name })
const settle = () => act(() => new Promise((r) => setTimeout(r, 600)))

function withStorage(persist: boolean) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persisted: async () => false, persist: async () => persist },
  })
}

async function open(store = memoryStore(), script: ConnectionResult[] = [{ ok: true }]) {
  const user = userEvent.setup()
  const ai = scriptedAiClient(script)
  const view = render(<Session store={store} ai={ai} />)
  return { user, ai, store, view }
}

async function pasteKey(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.click(screen.getByLabelText('API-Schlüssel'))
  await user.paste(key)
  await user.click(screen.getByRole('button', { name: 'Verbindung testen' }))
}

describe('setup plan', () => {
  it('a new project: welcome, key, privacy, backup', () => {
    expect(setupPlan({ ...makeProject(), privacyNoteSeen: false })).toEqual(['welcome', 'key', 'privacy', 'backup'])
  })
  it('a loaded backup in a new Chrome: only the key', () => {
    expect(setupPlan({ ...makeProject(), lastBackupAt: '2026-11-01T10:00:00.000Z' })).toEqual(['key'])
  })
})

describe('Setup: first start', () => {
  it('Neu starten → Willkommen → Schlüssel → Datenschutz → Backup → Übersicht', async () => {
    withStorage(true)
    const { user, ai, store } = await open()
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Bevor es losgeht' })).toBeTruthy()
    expect(screen.getByText(/Drei Dinge richtest du einmal ein/)).toBeTruthy()
    await user.click(next())

    expect(h1()).toBe('Verbindung zu Claude')
    // Focus moves to the new screen's heading.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    const list = screen.getByRole('list', { name: 'Einrichtung' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Verbindung zu Claude',
      'Datenschutz',
      'Erstes Backup',
    ])
    expect(within(list).getByText('Verbindung zu Claude').closest('li')!.getAttribute('aria-current')).toBe('step')
    // "Weiter" says why it can't go on yet.
    expect(next().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Teste zuerst die Verbindung.')).toBeTruthy()

    await pasteKey(user, dummyKey)
    expect(await screen.findByText('Verbindung erfolgreich. Der Schlüssel ist gespeichert.')).toBeTruthy()
    expect(ai.calls).toEqual([{ ...defaultSettings, apiKey: dummyKey }])
    expect(store.data.get(keys.settings)).toEqual({ ...defaultSettings, apiKey: dummyKey })
    await user.click(next())

    expect(h1()).toBe('Datenschutz')
    expect(screen.getByText(/keine Namen von Teilnehmenden/)).toBeTruthy()
    await user.click(next())
    await settle()
    expect((store.data.get(keys.project) as Project).privacyNoteSeen).toBe(true)

    expect(h1()).toBe('Erstes Backup')
    expect(screen.getByText('Chrome hebt deine Daten dauerhaft auf.')).toBeTruthy()
    expect(next('Fertig').getAttribute('aria-disabled')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Backup speichern' }))
    expect(downloads).toHaveLength(1)
    expect(await downloads[0]).not.toContain(dummyKey)
    expect(screen.getByText('Backup ist in deinen Downloads.').getAttribute('role')).toBe('status')
    await user.click(next('Fertig'))

    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
    expect(screen.getByRole('navigation').textContent).toContain('Backup: heute')
    expect(store.data.get(keys.settings)).toEqual({ ...defaultSettings, apiKey: dummyKey, setupDone: true })
  })

  it('after setup the app opens on home, without setup', async () => {
    const store = memoryStore({ [keys.project]: makeProject(), [keys.settings]: { ...defaultSettings, apiKey: dummyKey, setupDone: true } })
    await open(store)
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
  })

  it('Chrome refuses permanent storage: ⚠ with what to do', async () => {
    withStorage(false)
    await open(memoryStore({ [keys.project]: { ...makeProject(), privacyNoteSeen: true } }))
    await screen.findByRole('heading', { level: 1, name: 'Verbindung zu Claude' })
    // Plan here: key, backup.
    const { user } = { user: userEvent.setup() }
    await pasteKey(user, dummyKey)
    await screen.findByText(/Verbindung erfolgreich/)
    await user.click(next())
    expect(h1()).toBe('Erstes Backup')
    expect(screen.getByText(/Chrome kann deine Daten löschen/).textContent).toMatch(/Lesezeichen.*Cmd\+D/)
  })
})

describe('Setup: the key', () => {
  // As after loading a backup in a new Chrome: the key is the only screen.
  const backedUp = { ...makeProject(), lastBackupAt: '2026-11-01T10:00:00.000Z' }
  async function toKeyScreen(script: ConnectionResult[], store = memoryStore({ [keys.project]: backedUp })) {
    const opened = await open(store, script)
    await screen.findByRole('heading', { level: 1, name: 'Verbindung zu Claude' })
    return opened
  }

  it('a refused key: plain message at the field, nothing stored, "Weiter" stays blocked; a retry works', async () => {
    const { user, ai, store } = await toKeyScreen([{ ok: false, problem: 'key' }, { ok: true }])
    await pasteKey(user, dummyKey)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Claude nimmt diesen API-Schlüssel nicht an/)
    expect(alert.textContent).not.toContain(dummyKey.slice(-4))
    expect(screen.getByLabelText('API-Schlüssel').getAttribute('aria-invalid')).toBe('true')
    expect(store.data.has(keys.settings)).toBe(false)
    expect(next('Fertig').getAttribute('aria-disabled')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    expect(await screen.findByText(/Verbindung erfolgreich/)).toBeTruthy()
    expect(ai.calls).toHaveLength(2)
  })

  it.each([
    ['offline', /^Keine Internetverbindung/],
    ['credit', /Guthaben für Claude ist aufgebraucht/],
    ['busy', /überlastet/],
    // Setup has no way to the settings page, so the text doesn't point there.
    ['model', /kennt das eingestellte Modell „claude-opus-5-5“ nicht\. Gib Karim Bescheid/],
  ] as const)('%s → its own message, under the form; the key field stays unmarked', async (problem, text) => {
    const { user } = await toKeyScreen([{ ok: false, problem }])
    await pasteKey(user, dummyKey)
    expect((await screen.findByRole('alert')).textContent).toMatch(text)
    expect(screen.getByLabelText('API-Schlüssel').getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByLabelText('API-Schlüssel').getAttribute('aria-describedby')).not.toMatch(/error/)
  })

  it('after "Backup laden" the key screen says the project is already there', async () => {
    await toKeyScreen([{ ok: true }])
    expect(screen.getByText(/^Dein Projekt ist geladen\. In diesem Chrome fehlt nur noch der API-Schlüssel\./)).toBeTruthy()
  })

  it('a cut-off paste is refused at the field without calling Claude', async () => {
    const { user, ai } = await toKeyScreen([{ ok: true }])
    await pasteKey(user, dummyKey.slice(0, 10))
    expect(screen.getByRole('alert').textContent).toMatch(/nicht wie ein vollständiger API-Schlüssel/)
    expect(ai.calls).toHaveLength(0)
  })

  it('a new paste after a success has to be tested again', async () => {
    const { user } = await toKeyScreen([{ ok: true }])
    await pasteKey(user, dummyKey)
    await screen.findByText(/Verbindung erfolgreich/)
    await user.type(screen.getByLabelText('API-Schlüssel'), 'x')
    expect(screen.queryByText(/Verbindung erfolgreich/)).toBeNull()
    expect(next('Fertig').getAttribute('aria-disabled')).toBe('true')
  })

  it('a key saved before (setup left half-way) can be tested without pasting it again', async () => {
    const store = memoryStore({ [keys.project]: backedUp, [keys.settings]: { ...defaultSettings, apiKey: dummyKey } })
    const { user, ai } = await toKeyScreen([{ ok: true }], store)
    expect(screen.getByText(/Gespeichert ist ein Schlüssel, der auf c3AA endet/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    await screen.findByText(/Verbindung erfolgreich/)
    expect(ai.calls[0].apiKey).toBe(dummyKey)
    await user.click(next('Fertig'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Übersicht' })).toBeTruthy()
  })

  it('the key field is not a password field (Chrome would offer to save it)', async () => {
    await toKeyScreen([{ ok: true }])
    const input = screen.getByLabelText('API-Schlüssel') as HTMLInputElement
    expect(input.type).toBe('text')
    expect(input.className).toContain('key-input')
    expect(input.autocomplete).toBe('off')
  })
})

describe('Settings: "Verbindung testen"', () => {
  const withKey = () =>
    readyStore({ [keys.project]: makeProject(), [keys.settings]: { ...defaultSettings, apiKey: dummyKey, setupDone: true } })

  async function toSettings(store: ReturnType<typeof memoryStore>, script: ConnectionResult[]) {
    const opened = await open(store, script)
    await screen.findByRole('heading', { level: 1, name: 'Übersicht' })
    await opened.user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Einstellungen' }))
    return opened
  }

  it('tests the saved key, model and effort', async () => {
    const { user, ai } = await toSettings(withKey(), [{ ok: true }])
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    expect(await screen.findByText('Verbindung erfolgreich.')).toBeTruthy()
    expect(ai.calls).toEqual([{ ...defaultSettings, apiKey: dummyKey, setupDone: true }])
  })

  it('a failure shows the plain message; changing a setting clears the old result', async () => {
    const { user } = await toSettings(withKey(), [{ ok: false, problem: 'offline' }])
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }))
    expect(await screen.findByText(/^Keine Internetverbindung/)).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Denktiefe'), 'high')
    expect(screen.queryByText(/^Keine Internetverbindung/)).toBeNull()
  })

  it('without a key the button says why it does nothing', async () => {
    const { user, ai } = await toSettings(readyStore({ [keys.project]: makeProject() }), [{ ok: true }])
    const button = screen.getByRole('button', { name: 'Verbindung testen' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Speichere zuerst einen API-Schlüssel.')).toBeTruthy()
    await user.click(button)
    expect(ai.calls).toHaveLength(0)
  })
})
