import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PASTE } from '../../src/ai/chat'
import type { AiClient, SendOptions, SendResult } from '../../src/ai/client'
import { PDF_SYSTEM, continueInstruction } from '../../src/ai/pdf'
import type { Call } from '../../src/ai/request'
import { makeProject } from '../../src/domain/fixtures'
import type { Project } from '../../src/domain/schemas/project'
import { keys } from '../../src/storage/store'
import { Session } from '../../src/ui/Session'
import { readyStore } from '../stores'

// Step 15 through Session (design §6.2 "Step 15 design"): the file checks before any call, the
// reading panel, the text as a PDF source in the chat, continuation, the too-long and failure
// fallbacks, Stopp and a step switch. A hand-driven client: every request waits for the test.

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

const message = (content: unknown[], stop = 'end_turn') =>
  ({ id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as BetaMessage

function drivenAi() {
  const sent: { call: Call; options: SendOptions; resolve: (r: SendResult) => void }[] = []
  const ai: AiClient = {
    testConnection: async () => ({ ok: true }),
    send: (_settings, call, options = {}) =>
      new Promise<SendResult>((resolve) => {
        sent.push({ call, options, resolve })
        options.signal?.addEventListener('abort', () => resolve({ status: 'aborted' }))
      }),
  }
  const reply = (result: SendResult, i = sent.length - 1) => act(async () => sent[i].resolve(result))
  /** The PDF's text, as a reading round answers it. */
  const text = (t: string, stop = 'end_turn') => reply({ status: 'done', message: message([{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: t }], stop) })
  const progress = (t: string) => act(() => sent.at(-1)!.options.onEvent?.({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } } as never))
  return { ai, sent, reply, text, progress }
}

const PDF = '%PDF-1.4\n1 0 obj << >> endobj\n%%EOF'
const pdfFile = (name = 'Projektantrag.pdf', content = PDF) => new File([content], name, { type: 'application/pdf' })

async function open(start: Project = makeProject()) {
  const store = readyStore({ [keys.project]: start })
  const driven = drivenAi()
  const user = userEvent.setup()
  render(<Session store={store} ai={driven.ai} />)
  await user.click(await screen.findByRole('button', { name: /^0 Projekt,/ }))
  const block = within(screen.getByRole('region', { name: 'Baustein' }))
  const stored = async () => (await store.get(keys.project)) as Project
  return { user, driven, block, stored }
}

/** The file picker of the chat's PDF button (start panel, or the line above the composer). */
const chatInput = () => document.querySelector<HTMLInputElement>('.chat__log [data-pdf-input], .chat__paste-line [data-pdf-input]')!
/** Picks a file the way Chrome's picker does: the input's files change. */
const pick = (file: File, input = chatInput()) => act(async () => void fireEvent.change(input, { target: { files: [file] } }))
const sources = (p: Project) => p.steps[0].block.sources as { origin: string; label: string; text: string }[]
const lastTexts = (call: Call) => (call.messages.at(-1)!.content as { type: string; text?: string }[]).flatMap((b) => (b.type === 'text' ? [b.text!] : []))
const pdfButton = (name = 'PDF hochladen') => screen.getAllByRole('button', { name }).find((b) => !b.closest('.workspace__block'))!

describe('picking a file', () => {
  it('the start panel offers the PDF first; its button opens the file picker for PDFs', async () => {
    await open()
    const options = document.querySelectorAll('.start__option')
    expect(options).toHaveLength(3)
    within(options[0] as HTMLElement).getByRole('button', { name: 'PDF hochladen' })
    const input = chatInput()
    expect(input.accept).toBe('application/pdf,.pdf')
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    await userEvent.setup().click(pdfButton())
    expect(click).toHaveBeenCalledOnce()
  })

  it('refuses an empty file, a non-PDF and one over 24 MB before anything is sent', async () => {
    const { driven, stored } = await open()
    await pick(new File([''], 'leer.pdf'))
    await screen.findByText('„leer.pdf“ ist leer. Wähle eine andere Datei oder füge den Text ein.')
    // The name says PDF, the bytes don't.
    await pick(new File(['PK\u0003\u0004 kein pdf'], 'antrag.pdf'), document.querySelector<HTMLInputElement>('.chat__error [data-pdf-input]')!)
    await screen.findByText('„antrag.pdf“ ist keine echte PDF-Datei – sie heißt nur so. Wähl eine andere Datei oder füge den Text ein.')
    const big = pdfFile('riesig.pdf')
    Object.defineProperty(big, 'size', { value: 31_400_000 })
    await pick(big, document.querySelector<HTMLInputElement>('.chat__error [data-pdf-input]')!)
    await screen.findByText('„riesig.pdf“ ist zu groß (31,4 MB). Es geht bis 24 MB – füge sonst den Text ein.')
    screen.getByRole('button', { name: 'Anderes PDF wählen' })
    expect(driven.sent).toHaveLength(0)
    expect(sources(await stored())).toEqual([])
  })

  it('"Text einfügen" in the failure panel opens the paste form and clears the panel', async () => {
    const { user } = await open()
    await pick(new File([''], 'leer.pdf'))
    const panel = (await screen.findByRole('alert')).closest('.chat__error') as HTMLElement
    await user.click(within(panel).getByRole('button', { name: 'Text einfügen' }))
    screen.getByRole('form', { name: 'Text einfügen' })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('reading a PDF', () => {
  it('shows the reading panel with a live count, then sends the text as a PDF source and shows the app line', async () => {
    const { driven, stored, block } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    expect(document.querySelector('.start')).toBeNull()
    const [reading] = driven.sent
    expect(reading.call.system).toBe(PDF_SYSTEM)
    expect((reading.call.messages[0].content as { type: string; source?: { data: string } }[])[0]).toMatchObject({ type: 'document', source: { data: btoa(PDF) } })
    await driven.progress('Projektantrag „Am Ball“ ')
    screen.getByText('24 Zeichen gelesen')

    await driven.text('Projektantrag „Am Ball“\n\nTräger: Verein Beispiel e. V.')
    await screen.findByText('PDF gelesen: „Projektantrag“ · 54 Zeichen')
    expect(screen.queryByText(/wird gelesen/)).toBeNull()
    expect(driven.sent).toHaveLength(2)
    const turn = lastTexts(driven.sent[1].call).join('\n')
    expect(turn).toContain('[Quelle src1: „Projektantrag“]')
    expect(turn).toContain('Träger: Verein Beispiel e. V.')
    expect(turn).toContain('Die Person hat ein PDF hochgeladen')
    await waitFor(async () => expect(sources(await stored())).toEqual([expect.objectContaining({ origin: 'pdf', label: 'Projektantrag' })]))
    // The source row says where it came from.
    block.getByText(/^aus PDF am /)
  })

  it('continues after max_tokens (mock) and sends the whole text once', async () => {
    const { driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    await driven.text('Seite 1 bis 6', 'max_tokens')
    expect(driven.sent).toHaveLength(2)
    expect(driven.sent[1].call.messages.at(-1)!.content).toBe(continueInstruction('Seite 1 bis 6'))
    await driven.text(' und Seite 7 bis 12')
    await screen.findByText('PDF gelesen: „Projektantrag“ · 32 Zeichen')
    expect(lastTexts(driven.sent[2].call).join('\n')).toContain('Seite 1 bis 6 und Seite 7 bis 12')
  })

  it('while it reads, step 0 waits: the composer keeps its text, the paste form says why', async () => {
    const { user, driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    const input = screen.getByLabelText('Deine Nachricht')
    await user.type(input, 'Hallo{Enter}')
    expect(input).toHaveProperty('value', 'Hallo')
    expect(driven.sent).toHaveLength(1)
    // Says why, right above the composer, and the input points to it.
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Warte, bis das PDF gelesen ist.')
    // Stopp, then a paste form opened while another PDF reads.
    await user.click(screen.getByRole('button', { name: 'Stopp' }))
    expect(document.activeElement).toBe(input)
    await user.click(screen.getAllByRole('button', { name: 'Text einfügen' }).find((b) => !b.closest('.workspace__block'))!)
    await pick(pdfFile(), screen.getByRole('region', { name: 'Baustein' }).querySelector<HTMLInputElement>('[data-pdf-input]')!)
    await screen.findByText('„Projektantrag“ wird gelesen …')
    screen.getAllByText('Warte, bis das PDF gelesen ist.')
  })

  it('Stopp ends the call and stores nothing; the start panel comes back', async () => {
    const { user, driven, stored } = await open()
    await pick(pdfFile())
    await user.click(await screen.findByRole('button', { name: 'Stopp' }))
    expect(driven.sent[0].options.signal!.aborted).toBe(true)
    screen.getByText('Wie willst du anfangen?')
    expect(sources(await stored())).toEqual([])
    expect((await stored()).steps[0].segments).toEqual([])
  })

  it('survives a step switch and sends its text when done', async () => {
    const { user, driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    await user.click(screen.getByRole('button', { name: /^1 Gruppen,/ }))
    expect(screen.queryByText(/wird gelesen/)).toBeNull()
    await driven.text('Der ganze Antrag.')
    await user.click(screen.getByRole('button', { name: /^0 Projekt,/ }))
    await screen.findByText('PDF gelesen: „Projektantrag“ · 17 Zeichen')
  })
})

describe('when it goes wrong', () => {
  it('stopped after 4 rounds: the paste form opens with the text so far and a note, and sends it as a PDF source', async () => {
    const { user, driven, stored } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    for (let i = 0; i < 4; i++) await driven.text(`Teil ${i + 1}. `, 'max_tokens')
    const form = await screen.findByRole('form', { name: 'Text einfügen' })
    within(form).getByText(/Das PDF war zu lang, um es ganz zu lesen/)
    expect(within(form).getByLabelText('Text', { selector: 'textarea' })).toHaveProperty('value', 'Teil 1. Teil 2. Teil 3. Teil 4.')
    expect(within(form).getByLabelText('Bezeichnung')).toHaveProperty('value', 'Projektantrag')
    await user.click(within(form).getByRole('button', { name: 'Einfügen und senden' }))
    await screen.findByText('PDF gelesen: „Projektantrag“ · 31 Zeichen')
    await waitFor(async () => expect(sources(await stored())[0]).toMatchObject({ origin: 'pdf', text: 'Teil 1. Teil 2. Teil 3. Teil 4.' }))
  })

  it('more text than one turn may carry: the paste form says how much and blocks sending until it is shorter', async () => {
    const { driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    await driven.text('x'.repeat(MAX_PASTE + 1))
    const form = await screen.findByRole('form', { name: 'Text einfügen' })
    within(form).getByText('Der Text aus dem PDF hat 150.001 Zeichen – kürze ihn auf das Wichtigste (höchstens 150.000).')
    within(form).getByText(/Der Text ist zu lang/)
    expect(driven.sent).toHaveLength(1)
  })

  it('an API failure: the chat\'s text for it, "Erneut versuchen" sends the same file again', async () => {
    const { user, driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    await driven.reply({ status: 'failed', problem: 'busy' })
    await screen.findByText('Claude ist gerade überlastet. Warte kurz und versuch es dann noch einmal.')
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    await screen.findByText('„Projektantrag“ wird gelesen …')
    expect(driven.sent).toHaveLength(2)
    expect(driven.sent[1].call.messages).toEqual(driven.sent[0].call.messages)
  })

  it('an unreadable PDF (protected, too many pages) and a refusal say so; a bad key points to the settings', async () => {
    const { user, driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    await driven.reply({ status: 'failed', problem: 'other' })
    await screen.findByText(/vielleicht ist es geschützt oder hat mehr als 600 Seiten/)
    // Pasting leads here; trying the same file again is the quieter option.
    const banner = within(screen.getByRole('alert'))
    expect(banner.getByRole('button', { name: 'Text einfügen' }).className).toContain('btn--secondary')
    expect(banner.getByRole('button', { name: 'Erneut versuchen' }).className).toContain('btn--text')

    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    await driven.text('', 'refusal')
    await screen.findByText('Claude hat das Auslesen dieses PDFs abgelehnt. Füge den Text stattdessen ein.')
    screen.getByRole('button', { name: 'Anderes PDF wählen' })
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull()

    await pick(pdfFile(), document.querySelector<HTMLInputElement>('.chat__error [data-pdf-input]')!)
    await driven.reply({ status: 'failed', problem: 'key' })
    await screen.findByRole('button', { name: 'Zu den Einstellungen' })
    expect(driven.sent).toHaveLength(3)
  })

  it('a PDF with no text in it', async () => {
    const { driven } = await open()
    await pick(pdfFile())
    await screen.findByText('„Projektantrag“ wird gelesen …')
    await driven.text('   ')
    await screen.findByText('Im PDF „Projektantrag.pdf“ war kein Text zu finden. Füge den Text stattdessen ein.')
  })
})

describe('later in step 0', () => {
  it('"+ PDF hochladen" sits above the composer and in Quellen, and waits while a chat answer runs', async () => {
    const { user, driven, block } = await open()
    await user.type(screen.getByLabelText('Deine Nachricht'), 'Hallo{Enter}')
    expect(driven.sent).toHaveLength(1)
    const line = document.querySelector('.chat__paste-line') as HTMLElement
    within(line).getByText('Warte, bis die Antwort im Chat fertig ist.')
    block.getByRole('button', { name: 'PDF hochladen' })
    block.getByText('Noch keine Quelle – lade deinen Antrag als PDF hoch oder füge einen Text ein.')
    await pick(pdfFile())
    expect(driven.sent).toHaveLength(1)
  })
})
