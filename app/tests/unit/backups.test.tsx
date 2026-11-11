import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProject, makeProjectWithStatuses } from '../../src/domain/fixtures'
import { SCHEMA_VERSION, type Project } from '../../src/domain/schemas/project'
import { defaultSettings } from '../../src/storage/settings'
import { keys, memoryStore } from '../../src/storage/store'
import { readyStore } from '../stores'
import { Session } from '../../src/ui/Session'
import { scriptedAiClient } from '../../src/ai/mock'
import { dummyKey } from '../dummyKey'
import { v0Document } from './domain/v0'

// Step 6: backups (download, load over data, reminder, sidebar) and the settings page,
// all through the real Session with an in-memory store.

const DAY = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

/** Every downloaded file's text, in order. */
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
})

const nav = () => screen.getByRole('navigation', { name: 'Navigation' })
const backupStatus = () => nav().querySelector('[data-slot="backup-status"]')!.textContent

async function open(store = readyStore({ [keys.project]: makeProject() }), extra: Partial<Parameters<typeof Session>[0]> = {}) {
  const user = userEvent.setup()
  const view = render(<Session store={store} {...extra} />)
  await screen.findByRole('heading', { level: 1, name: 'Übersicht' })
  return { user, store, view }
}

async function toSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(nav()).getByRole('button', { name: 'Einstellungen' }))
  await screen.findByRole('heading', { level: 1, name: 'Einstellungen' })
}

// Pasted, like Lukas will (and fast: typing 60 characters one by one is slow under load).
async function enterKey(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.click(screen.getByLabelText(/API-Schlüssel/))
  await user.paste(key)
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
  await user.upload(input, new File([text], 'wirkungshelferin-backup.json', { type: 'application/json' }))
}

/** Waits for the debounced autosave. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 600)))

describe('Backup: download', () => {
  it('records the time in the project and in the file, so the sidebar says "heute"', async () => {
    const { user, store } = await open()
    expect(backupStatus()).toBe('Noch kein Backup')
    await toSettings(user)
    await user.click(screen.getByRole('button', { name: 'Backup speichern' }))
    expect(downloads).toHaveLength(1)
    const file = JSON.parse(await downloads[0]) as Project
    expect(file.lastBackupAt).toBeTruthy()
    expect(backupStatus()).toBe('Backup: heute')
    expect(screen.getByText('Backup ist in deinen Downloads.').getAttribute('role')).toBe('status')
    await settle()
    expect(store.data.get(keys.project)).toEqual(file)
  })

  it('a download from the save-failure banner counts too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = readyStore()
    store.set = () => Promise.reject(new Error('QuotaExceededError'))
    const user = userEvent.setup()
    render(<Session store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Neu starten' }))
    await user.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Backup speichern' }))
    expect(downloads).toHaveLength(1)
    expect((JSON.parse(await downloads[0]) as Project).lastBackupAt).toBeTruthy()
    expect(backupStatus()).toBe('Backup: heute')
  })

  it('a settings save that fails says so at the field', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const { user } = await open(store)
    store.set = () => Promise.reject(new Error('QuotaExceededError'))
    await toSettings(user)
    await user.selectOptions(screen.getByLabelText('Denktiefe'), 'high')
    expect(await screen.findByText('Speichern hat nicht geklappt. Versuch es noch einmal.')).toBeTruthy()
    expect(screen.getByLabelText('Denktiefe').getAttribute('aria-invalid')).toBe('true')
  })

  it('round trip: download → load into an empty browser → identical project', async () => {
    const original = makeProjectWithStatuses({ 0: 'confirmed', 1: 'in_progress' })
    const { user, view } = await open(readyStore({ [keys.project]: original }))
    await toSettings(user)
    await user.click(screen.getByRole('button', { name: 'Backup speichern' }))
    const text = await downloads[0]
    view.unmount()

    // A new Chrome: no settings at all, so setup asks for the key (and only for the key).
    const fresh = memoryStore()
    render(<Session store={fresh} ai={scriptedAiClient()} />)
    await screen.findByRole('button', { name: 'Neu starten' })
    await chooseFile(user, text)
    await screen.findByRole('heading', { level: 1, name: 'Verbindung zu Claude' })
    expect(screen.queryByRole('list', { name: 'Einrichtung' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeTruthy()
    expect(fresh.data.get(keys.project)).toEqual(JSON.parse(text))
    expect({ ...(JSON.parse(text) as Project), lastBackupAt: undefined }).toEqual({ ...original, lastBackupAt: undefined })
  })
})

describe('Backup: the API key never leaves the settings', () => {
  it('with a real key stored, neither the backup file nor the project document contains it', async () => {
    const { user, store } = await open()
    await toSettings(user)
    await enterKey(user, dummyKey)
    expect(await screen.findByText('••••••••c3AA')).toBeTruthy()
    expect((store.data.get(keys.settings) as { apiKey: string }).apiKey).toBe(dummyKey)

    await user.click(screen.getByRole('button', { name: 'Backup speichern' }))
    await settle()
    const file = await downloads[0]
    expect(file).not.toContain(dummyKey)
    expect(file).not.toContain(dummyKey.slice(-12))
    expect(file).not.toContain('apiKey')
    expect(JSON.stringify(store.data.get(keys.project))).not.toContain(dummyKey)
    // The page shows only the last four characters.
    expect(document.body.textContent).not.toContain(dummyKey.slice(0, 20))
  })
})

describe('Backup: load over existing data', () => {
  const current = () => makeProjectWithStatuses({ 0: 'in_progress' })
  const backup = makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed' })

  it('replaces the data only after the confirm dialog, which names the backup date', async () => {
    const before = current()
    const { user, store } = await open(readyStore({ [keys.project]: before }))
    await toSettings(user)
    await chooseFile(user, JSON.stringify({ ...backup, lastBackupAt: '2026-11-03T10:00:00.000Z' }))
    const dialog = await screen.findByRole('dialog', { name: 'Backup laden?' })
    expect(dialog.textContent).toContain('vom 3. November 2026')
    expect(store.data.get(keys.project)).toEqual(before)

    await user.click(within(dialog).getByRole('button', { name: 'Backup laden' }))
    expect(await screen.findByText('Backup geladen.')).toBeTruthy()
    expect(store.data.get(keys.project)).toEqual({ ...backup, lastBackupAt: '2026-11-03T10:00:00.000Z' })
    expect(within(nav()).getByRole('button', { name: '1 Gruppen, bestätigt' })).toBeTruthy()
  })

  it('"Abbrechen" changes nothing', async () => {
    const before = current()
    const { user, store } = await open(readyStore({ [keys.project]: before }))
    await toSettings(user)
    await chooseFile(user, JSON.stringify(backup))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abbrechen' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.data.get(keys.project)).toEqual(before)
    expect(within(nav()).getByRole('button', { name: '0 Projekt, in Arbeit' })).toBeTruthy()
  })

  it('an invalid file is rejected where it happened, and nothing changes', async () => {
    const before = current()
    const { user, store } = await open(readyStore({ [keys.project]: before }))
    await toSettings(user)
    await chooseFile(user, '{"kein":"backup"}')
    expect(await screen.findByText(/kein Backup der Wirkungshelferin/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.data.get(keys.project)).toEqual(before)
  })

  it('a file from a newer version is rejected, and nothing changes', async () => {
    const before = current()
    const { user, store } = await open(readyStore({ [keys.project]: before }))
    await toSettings(user)
    await chooseFile(user, JSON.stringify({ ...backup, schemaVersion: SCHEMA_VERSION + 1 }))
    expect(await screen.findByText(/neueren Version/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(store.data.get(keys.project)).toEqual(before)
  })
})

describe('Backup: reminder and sidebar status', () => {
  it('a backup 3 days old: sidebar says so, no reminder', async () => {
    await open(readyStore({ [keys.project]: { ...makeProject(), lastBackupAt: daysAgo(3) } }))
    expect(backupStatus()).toBe('Backup: vor 3 Tagen')
    expect(screen.queryByText(/Speichere ein neues/)).toBeNull()
  })

  it('9 days old: ⚠ reminder on home; saving makes it go and says where the file is', async () => {
    const { user } = await open(readyStore({ [keys.project]: { ...makeProject(), lastBackupAt: daysAgo(9) } }))
    expect(backupStatus()).toBe('Backup: vor 9 Tagen')
    const reminder = screen.getByText(/Dein letztes Backup ist 9 Tage alt/).closest('.banner') as HTMLElement
    await user.click(within(reminder).getByRole('button', { name: 'Backup speichern' }))
    expect(downloads).toHaveLength(1)
    expect(screen.queryByText(/Dein letztes Backup ist/)).toBeNull()
    expect(screen.getByText('Backup ist in deinen Downloads.')).toBeTruthy()
    expect(backupStatus()).toBe('Backup: heute')
  })

  it('never backed up, project 10 days old: reminder; 2 days old: none', async () => {
    const { view, user } = await open(readyStore({ [keys.project]: makeProject({ at: daysAgo(10) }) }))
    expect(screen.getByText('Du hast noch kein Backup gespeichert. Speichere jetzt eins, damit nichts verloren geht.')).toBeTruthy()
    // Settings shows the same ⚠ as the sidebar and home.
    await toSettings(user)
    expect(document.querySelector('.settings__status .status-icon--warn')).toBeTruthy()
    view.unmount()
    await open(readyStore({ [keys.project]: makeProject({ at: daysAgo(2) }) }))
    expect(screen.queryByText(/Du hast noch kein Backup gespeichert/)).toBeNull()
  })
})

describe('Settings page', () => {
  it('starts with the defaults and keeps changes across a reload', async () => {
    const store = readyStore({ [keys.project]: makeProject() })
    const { user, view } = await open(store)
    await toSettings(user)
    const model = screen.getByLabelText('Modell') as HTMLInputElement
    expect(model.value).toBe('claude-opus-5-5')
    expect((screen.getByLabelText('Denktiefe') as HTMLSelectElement).value).toBe('medium')

    await user.selectOptions(screen.getByLabelText('Denktiefe'), 'high')
    await user.clear(model)
    await user.type(model, 'claude-sonnet-5-5{Enter}')
    expect(store.data.get(keys.settings)).toEqual({ model: 'claude-sonnet-5-5', effort: 'high', setupDone: true })
    view.unmount()

    await open(store)
    await toSettings(user)
    expect((screen.getByLabelText('Modell') as HTMLInputElement).value).toBe('claude-sonnet-5-5')
    expect((screen.getByLabelText('Denktiefe') as HTMLSelectElement).value).toBe('high')
  })

  it('an empty model is not saved and says so at the field', async () => {
    const { user, store } = await open()
    await toSettings(user)
    await user.clear(screen.getByLabelText('Modell'))
    await user.tab()
    expect(screen.getByText('Gib ein Modell an. Standard ist claude-opus-5-5.')).toBeTruthy()
    expect(screen.getByLabelText('Modell').getAttribute('aria-invalid')).toBe('true')
    expect(store.data.get(keys.settings)).toEqual({ ...defaultSettings, setupDone: true })
  })

  it('a cut-off key is refused at the field and not stored', async () => {
    const { user, store } = await open()
    await toSettings(user)
    await enterKey(user, dummyKey.slice(0, 10))
    expect(screen.getByRole('alert').textContent).toMatch(/nicht wie ein vollständiger API-Schlüssel/)
    expect(store.data.get(keys.settings)).toEqual({ ...defaultSettings, setupDone: true })
    // Pasting again clears the message until the next check.
    await user.type(screen.getByLabelText('API-Schlüssel'), 'x')
    expect(screen.queryByText(/nicht wie ein vollständiger/)).toBeNull()
    expect(screen.getByLabelText('API-Schlüssel').getAttribute('aria-invalid')).toBeNull()
  })

  it('"ändern" replaces the key; "Abbrechen" keeps the old one', async () => {
    const { user, store } = await open(readyStore({ [keys.project]: makeProject(), [keys.settings]: { apiKey: dummyKey, model: 'claude-opus-5-5', effort: 'medium', setupDone: true } }))
    await toSettings(user)
    await user.click(screen.getByRole('button', { name: 'Ändern' }))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.getByText('••••••••c3AA')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Ändern' }))
    const next = `${dummyKey.slice(0, -4)}ZZ99`
    await enterKey(user, next)
    expect(await screen.findByText('••••••••ZZ99')).toBeTruthy()
    expect((store.data.get(keys.settings) as { apiKey: string }).apiKey).toBe(next)
  })

  it('"entfernen" asks first, then removes the key', async () => {
    const { user, store } = await open(readyStore({ [keys.project]: makeProject(), [keys.settings]: { apiKey: dummyKey, model: 'claude-opus-5-5', effort: 'medium', setupDone: true } }))
    await toSettings(user)
    await user.click(screen.getByRole('button', { name: 'Entfernen' }))
    const dialog = screen.getByRole('dialog', { name: 'API-Schlüssel entfernen?' })
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
    expect((store.data.get(keys.settings) as { apiKey?: string }).apiKey).toBe(dummyKey)

    await user.click(screen.getByRole('button', { name: 'Entfernen' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Entfernen' }))
    expect(store.data.get(keys.settings)).toEqual({ model: 'claude-opus-5-5', effort: 'medium', setupDone: true })
    expect(screen.getByLabelText('API-Schlüssel')).toBeTruthy()
  })
})

describe('Settings: previous version', () => {
  it('no pre-migration copy → no restore section', async () => {
    const { user } = await open()
    await toSettings(user)
    expect(screen.queryByRole('button', { name: 'Vorherige Version wiederherstellen' })).toBeNull()
  })

  it('restores the copy after the dialog and reloads; the unload flush writes nothing back', async () => {
    const raw = v0Document()
    const store = readyStore({ [keys.project]: makeProject(), [keys.preMigration(0)]: raw })
    const reload = vi.fn()
    const { user } = await open(store, { reload })
    await toSettings(user)
    await user.click(screen.getByRole('button', { name: 'Vorherige Version wiederherstellen' }))
    const dialog = screen.getByRole('dialog', { name: 'Vorherige Version wiederherstellen?' })
    expect(store.data.get(keys.project)).not.toEqual(raw)

    await user.click(within(dialog).getByRole('button', { name: 'Wiederherstellen' }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(store.data.get(keys.project)).toEqual(raw)
    act(() => void window.dispatchEvent(new Event('pagehide')))
    await settle()
    expect(store.data.get(keys.project)).toEqual(raw)
  })

  it('a document still pending from a failed save is not written back over the restored copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = v0Document()
    const store = readyStore({ [keys.project]: makeProject(), [keys.preMigration(0)]: raw })
    const set = store.set
    const ctl = { failing: false }
    // Current documents can't be saved while failing; the v0 copy can.
    store.set = (key, value) =>
      ctl.failing && (value as { schemaVersion?: number }).schemaVersion === SCHEMA_VERSION
        ? Promise.reject(new Error('QuotaExceededError'))
        : set(key, value)
    const reload = vi.fn()
    const { user } = await open(store, { reload })
    await toSettings(user)
    ctl.failing = true
    await user.click(screen.getByRole('button', { name: 'Backup speichern' }))
    await user.click(screen.getByRole('button', { name: 'Vorherige Version wiederherstellen' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Wiederherstellen' }))
    expect(store.data.get(keys.project)).toEqual(raw)

    // Storage recovers while the page unloads: the old pending document must stay away.
    ctl.failing = false
    act(() => void window.dispatchEvent(new Event('pagehide')))
    await settle()
    expect(store.data.get(keys.project)).toEqual(raw)
  })
})
