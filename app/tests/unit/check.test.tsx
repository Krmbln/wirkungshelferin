import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiClient, SendResult } from '../../src/ai/client'
import { CHECK_REQUEST } from '../../src/ai/check'
import type { Call } from '../../src/ai/request'
import { rubricCriteria } from '../../src/ai/tools'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import type { Project } from '../../src/domain/schemas/project'
import { keys, memoryStore } from '../../src/storage/store'
import { gateView } from '../../src/ui/check/gate'
import { Session } from '../../src/ui/Session'
import { readyStore } from '../stores'

// The quality gate (implementation plan step 13, design §6.2) through Session, with a
// hand-driven client: every request waits until the test answers it.

const AT = '2026-11-08T10:00:00.000Z'

let downloads = 0
beforeEach(() => {
  downloads = 0
  URL.createObjectURL = vi.fn(() => {
    downloads++
    return 'blob:x'
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const group = (id: string, fields: Record<string, unknown>) =>
  makeItem(1, 'targetGroups', { name: `Gruppe ${id}`, description: '', reach: 'direct', isFocus: false, why: 'Weil sie kommen.', ...fields }, { id })

function project(groups = [group('tg1', { name: 'Jugendliche', isFocus: true })]): Project {
  return makeProject({
    steps: {
      0: { status: 'confirmed' },
      1: {
        status: 'in_progress',
        block: {
          challenge: makeItem(1, 'challenge', { text: 'Zu wenig Orte am Nachmittag', why: 'Daran hängt alles.' }),
          targetGroups: groups,
          stakeholders: [],
        },
      },
    },
  })
}

const results = (warn: Record<string, string> = {}) =>
  rubricCriteria(1).map((c) => ({ criterion: c.id, result: c.id in warn ? 'warn' : 'ok', note: warn[c.id] ?? `Passt (${c.id}).` }))
const checkUse = (input: unknown) => ({ type: 'tool_use', id: 'toolu_check', name: 'report_quality_check', input })

type Sent = { call: Call; resolve: (r: SendResult) => void }

function drivenAi() {
  const sent: Sent[] = []
  const ai: AiClient = {
    testConnection: async () => ({ ok: true }),
    send: (_settings, call) => new Promise<SendResult>((resolve) => sent.push({ call, resolve })),
  }
  const reply = (result: SendResult) => act(async () => sent.at(-1)!.resolve(result))
  const answer = (content: unknown[]) =>
    reply({
      status: 'done',
      message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as BetaMessage,
    })
  return { ai, sent, reply, answer, check: (warn?: Record<string, string>) => answer([checkUse({ results: results(warn) })]) }
}

async function open(start = project()) {
  const store = readyStore({ [keys.project]: start })
  const driven = drivenAi()
  const user = userEvent.setup()
  render(<Session store={store} ai={driven.ai} />)
  await user.click(await screen.findByRole('button', { name: /^1 Gruppen,/ }))
  const gate = within(screen.getByRole('region', { name: 'Qualitätscheck' }))
  const stored = async () => (await store.get(keys.project)) as Project
  return { user, driven, store, gate, stored }
}

/** The text of the elements an element's aria-describedby names. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim()

const lastText = (call: Call) =>
  (call.messages.at(-1)!.content as { type: string; text?: string }[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text!)

describe('gate states (pure)', () => {
  const check = (p: Project, warn?: Record<string, string>) =>
    reducer(p, { type: 'check/store', step: 1, check: { at: AT, source: 'app', block: structuredClone(p.steps[1].block), results: results(warn) as never } })

  it('A → B / C → A after an edit → confirmed', () => {
    const missing = project([group('tg1', { isFocus: true, why: '' })])
    expect(gateView(missing, 1).kind).toBe('unchecked')
    const blocked = check(missing)
    expect(gateView(blocked, 1)).toMatchObject({ kind: 'blocked', blocking: [{ text: 'Warum fehlt: Zielgruppe „Gruppe tg1“' }] })
    // Criterion 8 is blocked by the code, so Claude's ✓ on it isn't shown.
    expect(gateView(blocked, 1).ok.map((r) => r.criterion)).not.toContain('8')

    const ready = check(project(), { 2: 'Zu allgemein.' })
    expect(gateView(ready, 1)).toMatchObject({ kind: 'ready', blocking: [], warn: [{ criterion: '2', note: 'Zu allgemein.' }] })
    const edited = reducer(ready, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Anders' } })
    expect(gateView(edited, 1).kind).toBe('changed')

    const confirmed = reducer(ready, { type: 'step/confirm', step: 1, at: AT })
    expect(gateView(confirmed, 1)).toMatchObject({ kind: 'confirmed', confirmedAt: AT, warn: [{ criterion: '2', confirmedAnyway: true }] })
    expect(gateView(reducer(confirmed, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { text: 'Anders' } }), 1).kind).toBe('changed')
  })

  it('after an edit only the ⛔ points that are still open stay', () => {
    const p = check(project([group('tg1', { isFocus: true, why: '' }), group('tg2', { why: '' })]))
    const fixed = reducer(p, { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { why: 'Darum.' } })
    expect(gateView(fixed, 1)).toMatchObject({ kind: 'changed', blocking: [{ text: 'Warum fehlt: Zielgruppe „Gruppe tg2“' }] })
  })
})

const focused = (el: Element) => expect(document.activeElement).toBe(el)

describe('Prüfen und bestätigen (Session)', () => {
  it('B: an empty Why blocks; the reason says how many; "Zum Feld" focuses the field; an edit goes back to A', async () => {
    const { user, driven, gate, stored } = await open(project([group('tg1', { name: 'Jugendliche', isFocus: true, why: '' })]))
    gate.getByText('Bevor du bestätigst, prüft die Wirkungshelferin den Baustein.')
    const primary = gate.getByRole('button', { name: 'Prüfen und bestätigen' })
    await user.click(primary)
    expect(primary.getAttribute('aria-busy')).toBe('true')
    within(primary).getByText('prüft …')
    // A second click while it runs sends nothing.
    await user.click(primary)
    expect(driven.sent).toHaveLength(1)
    expect(lastText(driven.sent[0].call)).toContain(`[App] ${CHECK_REQUEST}`)
    expect(driven.sent[0].call.maxTokens).toBe(8000)

    await driven.check()
    const confirm = gate.getByRole('button', { name: 'Bestätigen' })
    expect(confirm.getAttribute('aria-disabled')).toBe('true')
    expect(description(confirm)).toBe('Noch 1 Punkt blockiert das Bestätigen')
    const toField = gate.getByRole('button', { name: 'Zum Feld: Warum fehlt: Zielgruppe „Jugendliche“' })
    await waitFor(() => focused(toField))
    // The field shows its ⛔ marker now.
    const why = document.querySelector<HTMLTextAreaElement>('[data-item-id="tg1"] [data-field="why"] textarea')!
    expect(why.getAttribute('aria-invalid')).toBe('true')
    expect(why.closest('[data-field="why"]')!.textContent).toContain('fehlt')

    await user.click(toField)
    focused(why)
    await user.click(confirm)
    expect((await stored()).steps[1].status).toBe('in_progress')

    await user.type(why, 'Bei ihnen wirkt es.{Enter}')
    gate.getByText('Geändert seit der Prüfung – erneut prüfen')
    expect(gate.queryByRole('button', { name: /^Zum Feld/ })).toBeNull()
    expect(why.getAttribute('aria-invalid')).not.toBe('true')
    gate.getByRole('button', { name: 'Prüfen und bestätigen' })
  })

  it('C with ⚠: the question opens at once; Bestätigen stores the step, the ⚠ points and the backup prompt follows', async () => {
    const { user, driven, gate, stored } = await open()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.check({ 2: 'Wer genau dazugehört, ist offen.', 7: 'Keine Beteiligten.' })
    gate.getByText('Wer genau dazugehört, ist offen.')
    gate.getByText('2 offene Punkte werden mit gespeichert. Trotzdem bestätigen?')
    const yes = within(gate.getByRole('group', { name: 'Trotzdem bestätigen?' })).getByRole('button', { name: 'Bestätigen' })
    await waitFor(() => focused(yes))
    expect(gate.getByRole('button', { name: '6 Punkte erfüllt' }).getAttribute('aria-expanded')).toBe('false')

    await user.click(yes)
    await waitFor(async () => expect((await stored()).steps[1].status).toBe('confirmed'))
    const s = (await stored()).steps[1]
    expect(s.confirmedWarnings).toEqual(['2', '7'])
    expect(s.confirmed?.basis[0]).toBeDefined()
    screen.getByRole('button', { name: '1 Gruppen, bestätigt' })
    gate.getByText('Bestätigt heute')
    expect(gate.getAllByText('· trotzdem bestätigt')).toHaveLength(2)
    gate.getByText('Schritt bestätigt. Jetzt Backup speichern?')
    const save = gate.getByRole('button', { name: 'Backup speichern' })
    await waitFor(() => focused(save))
    await user.click(save)
    expect(downloads).toBe(1)
    await waitFor(() => focused(gate.getByText('Backup ist in deinen Downloads.')))
  })

  it('Abbrechen keeps the step open, focus back on Bestätigen', async () => {
    const { user, driven, gate, stored } = await open()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.check({ 4: 'Nur Defizite.' })
    await user.click(gate.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => focused(gate.getByRole('button', { name: 'Bestätigen' })))
    expect((await stored()).steps[1].status).toBe('in_progress')
    expect((await stored()).steps[1].qualityCheck?.results).toHaveLength(8)
  })

  it('no ⚠ at all confirms at once; Später closes the prompt', async () => {
    const { user, driven, gate, stored } = await open()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.check()
    await waitFor(async () => expect((await stored()).steps[1].status).toBe('confirmed'))
    expect((await stored()).steps[1].confirmedWarnings).toEqual([])
    await waitFor(() => focused(gate.getByRole('button', { name: 'Backup speichern' })))
    await user.click(gate.getByRole('button', { name: 'Später' }))
    expect(gate.queryByText('Schritt bestätigt. Jetzt Backup speichern?')).toBeNull()
    await waitFor(() => focused(gate.getByText('Bestätigt heute')))
  })

  it('Nur prüfen checks without confirming; focus moves to Bestätigen', async () => {
    const { user, driven, gate, stored } = await open()
    await user.click(gate.getByRole('button', { name: 'Nur prüfen' }))
    await driven.check()
    await waitFor(() => focused(gate.getByRole('button', { name: 'Bestätigen' })))
    expect((await stored()).steps[1].status).toBe('in_progress')
    expect(gate.queryByRole('button', { name: 'Nur prüfen' })).toBeNull()
    await user.click(gate.getByRole('button', { name: 'Bestätigen' }))
    await waitFor(async () => expect((await stored()).steps[1].status).toBe('confirmed'))
  })
})

describe('Zum Feld targets', () => {
  it('no focus group → the first group\'s Fokusgruppe box; no group at all → "+ hinzufügen"', async () => {
    const { user, gate } = await open(project([group('tg1', { name: 'Jugendliche' })]))
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await user.click(gate.getByRole('button', { name: 'Zum Feld: Noch keine Fokusgruppe gewählt (1 oder 2)' }))
    focused(document.querySelector('[data-item-id="tg1"] [data-field="isFocus"]')!)
    document.body.innerHTML = ''

    const empty = await open(project([]))
    await empty.user.click(empty.gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await empty.user.click(empty.gate.getByRole('button', { name: /^Zum Feld: Noch keine Fokusgruppe/ }))
    focused(screen.getByRole('button', { name: 'Zielgruppe hinzufügen' }))
  })
})

describe('when the check fails', () => {
  it('a problem shows in the gate; the primary button tries again (one retry, not two)', async () => {
    const { user, driven, gate } = await open()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.reply({ status: 'failed', problem: 'offline' })
    expect(gate.getByRole('alert').textContent).toContain('Keine Internetverbindung.')
    expect(gate.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    expect(driven.sent).toHaveLength(2)
    await driven.check()
    expect(gate.queryByRole('alert')).toBeNull()
  })

  it('the ⛔ points show at once, while the check runs and when it fails (offline too)', async () => {
    const { user, driven, gate } = await open(project([group('tg1', { name: 'Jugendliche', isFocus: true, why: '' })]))
    const why = () => document.querySelector<HTMLTextAreaElement>('[data-item-id="tg1"] [data-field="why"] textarea')!
    expect(gate.queryByRole('button', { name: /^Zum Feld/ })).toBeNull()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    gate.getByRole('button', { name: 'Zum Feld: Warum fehlt: Zielgruppe „Jugendliche“' })
    expect(why().getAttribute('aria-invalid')).toBe('true')
    await driven.reply({ status: 'failed', problem: 'offline' })
    await user.click(gate.getByRole('button', { name: 'Zum Feld: Warum fehlt: Zielgruppe „Jugendliche“' }))
    focused(why())
  })

  it('a refused check shows the refusal; a stored check stays as it was', async () => {
    const { user, driven, gate, stored } = await open()
    await user.click(gate.getByRole('button', { name: 'Nur prüfen' }))
    await driven.reply({
      status: 'done',
      message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as BetaMessage,
    })
    expect(gate.getByRole('alert').textContent).toContain('abgelehnt')
    expect((await stored()).steps[1].qualityCheck).toBeUndefined()
  })

  it('an answer without a check is "kein Ergebnis"; a key problem points to the settings', async () => {
    const { user, driven, gate } = await open()
    await user.click(gate.getByRole('button', { name: 'Nur prüfen' }))
    await driven.answer([{ type: 'text', text: 'Sieht gut aus!' }])
    expect(gate.getByRole('alert').textContent).toContain('Die Prüfung hat kein Ergebnis gebracht.')
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.reply({ status: 'failed', problem: 'key' })
    await user.click(gate.getByRole('button', { name: 'Zu den Einstellungen' }))
    screen.getByRole('heading', { level: 1, name: 'Einstellungen' })
  })
})

describe('gate and chat', () => {
  it('while an answer runs in the chat, the check waits', async () => {
    const { user, gate } = await open()
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Hallo{Enter}')
    const primary = gate.getByRole('button', { name: 'Prüfen und bestätigen' })
    expect(primary.getAttribute('aria-disabled')).toBe('true')
    expect(description(primary)).toBe('Warte, bis die Antwort im Chat fertig ist.')
    expect(gate.queryByRole('button', { name: 'Nur prüfen' })).toBeNull()
  })

  it('a check Claude reports in the chat fills the gate (state C)', async () => {
    const { user, driven, gate } = await open()
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Prüf bitte.{Enter}')
    await driven.answer([{ type: 'text', text: 'Ich habe geprüft. Willst du bestätigen?' }, checkUse({ results: results({ 3: 'Eltern eher indirekt.' }) })])
    gate.getByText('Eltern eher indirekt.')
    expect(gate.getByRole('button', { name: 'Bestätigen' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('the next chat turn tells Claude about the check and the confirm', async () => {
    const { user, driven, gate } = await open()
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.check({ 4: 'Nur Defizite.' })
    await user.click(within(gate.getByRole('group', { name: 'Trotzdem bestätigen?' })).getByRole('button', { name: 'Bestätigen' }))
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Und jetzt?{Enter}')
    const text = lastText(driven.sent[1].call).join('\n')
    expect(text).toContain('[App] Die Person hat den Qualitätscheck in der App ausgeführt.')
    expect(text).toContain('⚠ 4 Stärken mitgedacht: Nur Defizite.')
    expect(text).toContain('[App] Die Person hat den Schritt bestätigt, mit offenen Punkten (⚠ 4).')
  })

  it('a gate check that lands after a chat turn: the next turn still hears about it', async () => {
    const { user, driven, gate } = await open()
    await user.click(gate.getByRole('button', { name: 'Nur prüfen' }))
    const gateCheck = driven.sent[0]
    // The chat isn't blocked while the check runs.
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Hallo{Enter}')
    await driven.answer([{ type: 'text', text: 'Erzähl.' }])
    await act(async () =>
      gateCheck.resolve({
        status: 'done',
        message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [checkUse({ results: results({ 6: 'Stiftung als Zielgruppe.' }) })], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as BetaMessage,
      }),
    )
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Und?{Enter}')
    expect(lastText(driven.sent.at(-1)!.call).join('\n')).toContain('⚠ 6 Zielgruppe ≠ Beteiligte: Stiftung als Zielgruppe.')

  })

  it('switching steps while the check runs keeps the result', async () => {
    const { user, driven, stored } = await open()
    await user.click(within(screen.getByRole('region', { name: 'Qualitätscheck' })).getByRole('button', { name: 'Nur prüfen' }))
    await user.click(screen.getByRole('button', { name: /^2 Problem,/ }))
    await driven.check()
    await waitFor(async () => expect((await stored()).steps[1].qualityCheck?.source).toBe('app'))
    await user.click(screen.getByRole('button', { name: /^1 Gruppen,/ }))
    within(screen.getByRole('region', { name: 'Qualitätscheck' })).getByRole('button', { name: 'Bestätigen' })
  })

  it('a reload keeps the check', async () => {
    const first = await open()
    await first.user.click(first.gate.getByRole('button', { name: 'Nur prüfen' }))
    await first.driven.check({ 2: 'Offen.' })
    await waitFor(async () => expect((await first.stored()).steps[1].qualityCheck).toBeDefined())
    document.body.innerHTML = ''
    const store = memoryStore(Object.fromEntries(first.store.data))
    render(<Session store={store} ai={drivenAi().ai} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /^1 Gruppen,/ }))
    within(screen.getByRole('region', { name: 'Qualitätscheck' })).getByText('Offen.')
  })
})
