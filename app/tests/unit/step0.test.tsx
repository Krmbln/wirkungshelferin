import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiClient, SendResult } from '../../src/ai/client'
import type { Call } from '../../src/ai/request'
import { rubricCriteria } from '../../src/ai/tools'
import { makeItem, makeProject } from '../../src/domain/fixtures'
import { emptyFields } from '../../src/domain/schemas/blocks'
import type { Project } from '../../src/domain/schemas/project'
import { keys } from '../../src/storage/store'
import { Session } from '../../src/ui/Session'
import { readyStore } from '../stores'

// Step 0 through Session (implementation plan step 14, design §6.2 "Step 14 design"): start
// panel, paste form, interview, the form's three field states, the check, and the hand-off
// to step 1. A hand-driven client: every request waits until the test answers it.

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const message = (content: unknown[], stop = 'end_turn') =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as BetaMessage

function drivenAi() {
  const sent: { call: Call; resolve: (r: SendResult) => void }[] = []
  const ai: AiClient = {
    testConnection: async () => ({ ok: true }),
    send: (_settings, call) => new Promise<SendResult>((resolve) => sent.push({ call, resolve })),
  }
  const reply = (result: SendResult, i = sent.length - 1) => act(async () => sent[i].resolve(result))
  const answer = (content: unknown[], i?: number) => reply({ status: 'done', message: message(content, content.some((b) => (b as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn') }, i)
  return { ai, sent, reply, answer }
}

const profileFields = (over: Record<string, unknown>) => ({ ...emptyFields(0, 'profile'), budgetRange: '', ...over })
const proposeProfile = (over: Record<string, unknown>) => ({
  type: 'tool_use',
  id: 'toolu_p1',
  name: 'propose_changes',
  input: { summary: 'Ein erster Entwurf für das Profil.', changes: [{ op: 'update', collection: 'profile', id: 'profile', fields: profileFields(over) }] },
})
const checkWithout1 = () => ({
  type: 'tool_use',
  id: 'toolu_check',
  name: 'report_quality_check',
  input: { results: rubricCriteria(0).filter((c) => c.id !== '1').map((c) => ({ criterion: c.id, result: 'ok', note: `Passt (${c.id}).` })) },
})

/** Text blocks of a request's newest user turn. */
const lastTexts = (call: Call) => (call.messages.at(-1)!.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text!)
const focused = (el: Element) => expect(document.activeElement).toBe(el)

async function open(start: Project = makeProject()) {
  const store = readyStore({ [keys.project]: start })
  const driven = drivenAi()
  const user = userEvent.setup()
  render(<Session store={store} ai={driven.ai} />)
  await user.click(await screen.findByRole('button', { name: /^0 Projekt,/ }))
  const block = within(screen.getByRole('region', { name: 'Baustein' }))
  const gate = within(screen.getByRole('region', { name: 'Qualitätscheck' }))
  const stored = async () => (await store.get(keys.project)) as Project
  return { user, driven, store, block, gate, stored }
}

const intro = () => screen.getByRole('button', { name: 'Worum geht es?' })
/** The chat's "Text einfügen" (start panel or the line above the composer), not the Quellen section's. */
const pasteButton = () => screen.getAllByRole('button', { name: 'Text einfügen' }).find((b) => !b.closest('.workspace__block'))!

describe('start panel and paste form', () => {
  it('an empty step 0 offers Text einfügen and Interview; the form replaces the composer, folds the intro and gets focus', async () => {
    const { user } = await open()
    expect(intro().getAttribute('aria-expanded')).toBe('true')
    screen.getByText('Wie willst du anfangen?')
    await user.click(pasteButton())
    const form = screen.getByRole('form', { name: 'Text einfügen' })
    expect(screen.queryByLabelText('Deine Nachricht')).toBeNull()
    expect(screen.queryByText('Wie willst du anfangen?')).toBeNull()
    expect(intro().getAttribute('aria-expanded')).toBe('false')
    focused(within(form).getByLabelText('Text'))
    const send = within(form).getByRole('button', { name: 'Einfügen und senden' })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    screen.getByText('Füge zuerst einen Text ein.')
  })

  it('Esc does nothing; Abbrechen brings back start panel, intro and the composer with its text', async () => {
    const { user } = await open()
    await user.type(screen.getByLabelText('Deine Nachricht'), 'Halb geschrieben')
    await user.click(pasteButton())
    await user.click(screen.getByLabelText('Text'))
    await user.paste('Ein langer Antrag')
    await user.keyboard('{Escape}')
    screen.getByRole('form', { name: 'Text einfügen' })
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    screen.getByText('Wie willst du anfangen?')
    expect(intro().getAttribute('aria-expanded')).toBe('true')
    const input = screen.getByLabelText('Deine Nachricht')
    expect((input as HTMLTextAreaElement).value).toBe('Halb geschrieben')
    await waitFor(() => focused(input))
  })

  it('Cmd+Enter sends: the source lands in Quellen, the chat shows the app line, Claude reads the full text once', async () => {
    const { user, driven, block, stored } = await open()
    await user.click(pasteButton())
    await user.type(screen.getByLabelText('Bezeichnung'), 'Antrag 2026')
    await user.click(screen.getByLabelText('Text'))
    await user.paste('Schraubzeit ist eine offene Fahrradwerkstatt.')
    screen.getByText('45 Zeichen')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(driven.sent).toHaveLength(1))
    expect(lastTexts(driven.sent[0].call)[1]).toBe('[Quelle src1: „Antrag 2026“]\nSchraubzeit ist eine offene Fahrradwerkstatt.')
    screen.getByText('Text eingefügt: „Antrag 2026“ · 45 Zeichen')
    block.getByText('eingefügt am', { exact: false })
    expect(block.getByLabelText('Bezeichnung der Quelle')).toHaveProperty('value', 'Antrag 2026')
    expect((await stored()).steps[0].block.sources).toHaveLength(1)
    expect(screen.queryByRole('form', { name: 'Text einfügen' })).toBeNull()
    await waitFor(() => focused(screen.getByLabelText('Deine Nachricht')))
    // While the answer runs, a second paste waits.
    await user.click(pasteButton())
    within(screen.getByRole('form', { name: 'Text einfügen' })).getByText('Warte, bis die Antwort im Chat fertig ist.')
  })

  it('a paste being prepared survives a step switch', async () => {
    const { user } = await open()
    await user.click(pasteButton())
    await user.click(screen.getByLabelText('Text'))
    await user.paste('Entwurf eines Antrags')
    await user.click(screen.getByRole('button', { name: /^1 Gruppen,/ }))
    await user.click(screen.getByRole('button', { name: /^0 Projekt,/ }))
    expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value).toBe('Entwurf eines Antrags')
  })

  it('Interview starten sends an app turn and shows "Interview gestartet"', async () => {
    const { user, driven } = await open()
    await user.click(screen.getByRole('button', { name: 'Interview starten' }))
    await waitFor(() => expect(driven.sent).toHaveLength(1))
    expect(lastTexts(driven.sent[0].call).at(-2)).toMatch(/^\[App\] Die Person hat nichts Schriftliches/)
    screen.getByText('Interview gestartet')
    await driven.answer([{ type: 'text', text: 'Frage 1 von 8: Wie heißt das Projekt?' }])
    // Starting the interview counts as acting: the intro stays folded.
    expect(intro().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the form', () => {
  it('a first draft card applies; "offen" shows as the chip; tabbing in opens an empty field, leaving it empty keeps "offen"', async () => {
    const { user, driven, block, stored } = await open()
    await user.click(screen.getByRole('button', { name: 'Interview starten' }))
    await waitFor(() => expect(driven.sent).toHaveLength(1))
    await driven.answer([{ type: 'text', text: 'Das habe ich bisher.' }, proposeProfile({ name: 'Schraubzeit', location: 'offen' })])
    const card = within(screen.getByRole('article', { name: 'Vorschlag' }))
    card.getByText('Projektprofil')
    card.getByText('Neu')
    expect(card.getAllByText('offen').length).toBeGreaterThan(0)
    await user.click(card.getByRole('button', { name: 'Übernehmen: Neu – Projektprofil' }))
    expect((await stored()).steps[0].block.profile).toMatchObject({ name: 'Schraubzeit', location: 'offen' })

    const ort = block.getByRole('button', { name: /^Ort/ })
    within(ort).getByText('noch unbekannt')
    ort.focus()
    const area = await waitFor(() => block.getByRole('textbox', { name: 'Ort' }))
    expect((area as HTMLTextAreaElement).value).toBe('')
    expect(area.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.getElementById(area.getAttribute('aria-describedby')!)?.textContent).toBe('derzeit als offen markiert')
    await user.keyboard('{Escape}')
    expect((await stored()).steps[0].block.profile.location).toBe('offen')
    await waitFor(() => block.getByRole('button', { name: /^Ort/ }))

    // Typing an answer replaces "offen" (Enter saves, as everywhere).
    block.getByRole('button', { name: /^Ort/ }).focus()
    await user.type(await waitFor(() => block.getByRole('textbox', { name: 'Ort' })), 'Weidengrund{Enter}')
    await waitFor(async () => expect((await stored()).steps[0].block.profile.location).toBe('Weidengrund'))
    block.getByText('von dir geändert')
  })

  it('"als offen markieren" waits for content, then marks, announces and moves to the next leer field', async () => {
    const start = makeProject({ steps: { 0: { status: 'in_progress' } } })
    const { user, block, stored } = await open(start)
    expect(block.queryAllByRole('button', { name: /als offen markieren$/ })).toHaveLength(0)
    block.getByText(/Lade links ein PDF hoch, füge einen Text ein oder lass dich interviewen/)
    await user.type(block.getByRole('textbox', { name: 'Name des Projekts' }), 'Schraubzeit{Enter}')
    await user.click(await block.findByRole('button', { name: 'Träger als offen markieren' }))
    await waitFor(async () => expect((await stored()).steps[0].block.profile.organisation).toBe('offen'))
    await waitFor(() => focused(block.getByRole('button', { name: 'Projektgrenze als offen markieren' })))
    screen.getByText('Träger: offen')
    // A list field holds "offen" as its only entry.
    await user.click(block.getByRole('button', { name: 'Aktivitäten als offen markieren' }))
    await waitFor(async () => expect((await stored()).steps[0].block.profile.activities).toEqual(['offen']))
    // No button for fields that may stay empty; the frame waits for its own content.
    expect(block.queryByRole('button', { name: 'Budgetrahmen als offen markieren' })).toBeNull()
    expect(block.queryByRole('button', { name: 'Für wen? als offen markieren' })).toBeNull()
  })

  it('a source can be read and removed; the undo line says the chat still knows it', async () => {
    const source = makeItem(0, 'sources', { origin: 'paste', label: 'Antrag', text: 'Der ganze Antragstext.', at: '2026-11-08T10:00:00.000Z' })
    const { user, block, stored } = await open(makeProject({ steps: { 0: { status: 'in_progress', block: { sources: [source] } } } }))
    const toggle = block.getByRole('button', { name: 'Text ansehen' })
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    block.getByText('Der ganze Antragstext.')
    await user.click(block.getByRole('button', { name: 'Quelle „Antrag“ entfernen' }))
    block.getByText('„Antrag“ entfernt. Der Chat kennt den Text weiter.')
    expect((await stored()).steps[0].block.sources).toHaveLength(0)
    await user.click(block.getByRole('button', { name: 'Rückgängig' }))
    await waitFor(async () => expect((await stored()).steps[0].block.sources).toHaveLength(1))
  })
})

/** Step 0 with everything filled except the given profile fields. */
function almostDone(leer: string[] = []) {
  const profile = makeItem(0, 'profile', {
    name: 'Schraubzeit',
    organisation: 'Nachbarschaftshaus',
    projectBoundary: 'Die offene Werkstatt',
    location: 'Weidengrund',
    activities: ['Offene Werkstatt'],
    participants: 'Jugendliche',
    team: 'offen',
    duration: '2026–2027',
    funder: 'Stiftung',
    statedGoals: ['Mobiler werden'],
    otherOffers: ['offen'],
    ...Object.fromEntries(leer.map((f) => [f, ''])),
  })
  const frame = makeItem(0, 'frame', { purpose: 'beides', audience: 'Stiftung', requiredFormat: 'offen', requiredFigures: ['Teilnahmen'], existingData: ['Liste'] })
  const source = makeItem(0, 'sources', { origin: 'paste', label: 'Antrag', text: 'Der ganze Antragstext.', at: '2026-11-08T10:00:00.000Z' })
  return makeProject({ steps: { 0: { status: 'in_progress', block: { profile, frame, sources: [source] } } } })
}

describe('check and hand-off to step 1', () => {
  it('criterion 1 from the app: ⚠ with the leer fields, "Zum Feld" to the first of them', async () => {
    const { user, driven, gate, block } = await open(almostDone(['location', 'duration']))
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.answer([checkWithout1()])
    gate.getByText('Noch leer, nicht als offen markiert: Ort, Laufzeit')
    await user.click(gate.getByRole('button', { name: 'Abbrechen' }))
    await user.click(gate.getByRole('button', { name: /^Zum Feld/ }))
    focused(block.getByRole('textbox', { name: 'Ort' }))
  })

  it('confirming starts step 1\'s draft at once; the banner follows it live; Weiter opens step 1 with the draft and its intro', async () => {
    const { user, driven, gate, stored } = await open(almostDone())
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.answer([checkWithout1()])
    // No ⚠ left: confirms at once, and the opening goes out for step 1.
    await waitFor(() => expect(driven.sent).toHaveLength(2))
    expect((await stored()).steps[0].status).toBe('confirmed')
    const opening = driven.sent[1].call
    expect(opening.system).toContain('Schritt 1')
    const [context, line] = lastTexts(opening)
    expect(context).toContain('[Quelle src1: „Antrag“]\nDer ganze Antragstext.')
    expect(line).toMatch(/^\[App\] Die Person hat Schritt 0 gerade bestätigt/)
    gate.getByText('Schritt 0 bestätigt. Die Wirkungshelferin schreibt den ersten Entwurf für Schritt 1 …')
    expect(gate.queryByText('Schritt bestätigt. Jetzt Backup speichern?')).toBeNull()
    const next = gate.getByRole('button', { name: 'Weiter zu Schritt 1' })
    await waitFor(() => focused(next))
    gate.getByRole('button', { name: 'Backup speichern' })
    // Step 0 stays usable while step 1's turn runs.
    expect(screen.getByLabelText('Deine Nachricht')).toBeTruthy()
    expect(screen.queryByText('Warte, bis die Antwort im Chat fertig ist.')).toBeNull()

    await driven.answer([{ type: 'text', text: 'Hier ist mein erster Entwurf.' }], 1)
    gate.getByText('Schritt 0 bestätigt. Der erste Entwurf für Schritt 1 ist fertig.')
    await user.click(gate.getByRole('button', { name: 'Weiter zu Schritt 1' }))
    await waitFor(() => focused(screen.getByRole('heading', { level: 1 })))
    screen.getByText('Schritt 0 bestätigt')
    screen.getByText('Hier ist mein erster Entwurf.')
    expect(intro().getAttribute('aria-expanded')).toBe('true')
  })

  it('a failed draft says so in the banner', async () => {
    const { user, driven, gate } = await open(almostDone())
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.answer([checkWithout1()])
    await waitFor(() => expect(driven.sent).toHaveLength(2))
    await driven.reply({ status: 'failed', problem: 'busy' }, 1)
    gate.getByText('Schritt 0 bestätigt. Der Entwurf für Schritt 1 hat nicht geklappt – in Schritt 1 kannst du es erneut versuchen.')
  })

  it('re-confirming when step 1 already has a chat: the normal backup question, nothing sent', async () => {
    const start = almostDone()
    start.steps[1].segments = [{ id: 's1', startedAt: '2026-11-08T09:00:00.000Z', messages: [{ id: 'm1', at: '2026-11-08T09:00:00.000Z', role: 'user', content: [{ type: 'text', text: 'Hallo' }, { type: 'text', text: '[Baustein unverändert]' }] }] }]
    const { user, driven, gate } = await open(start)
    await user.click(gate.getByRole('button', { name: 'Prüfen und bestätigen' }))
    await driven.answer([checkWithout1()])
    await waitFor(() => gate.getByText('Schritt bestätigt. Jetzt Backup speichern?'))
    expect(driven.sent).toHaveLength(1)
  })
})
