import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it } from 'vitest'
import type { AiClient, SendOptions, SendResult } from '../../src/ai/client'
import type { Call } from '../../src/ai/request'
import { makeProject } from '../../src/domain/fixtures'
import type { Project } from '../../src/domain/schemas/project'
import { keys, memoryStore } from '../../src/storage/store'
import { Markdown } from '../../src/ui/chat/Markdown'
import { Session } from '../../src/ui/Session'
import { readyStore } from '../stores'

// The chat column against a hand-driven client: the test decides when each event arrives
// (implementation plan step 9). Recorded streams run through the real SDK in ai/chat.test.ts.

type Pending = { call: Call; options: SendOptions; resolve: (r: SendResult) => void; text: string }

function drivenAi() {
  const pending: Pending[] = []
  const ai: AiClient = {
    testConnection: async () => ({ ok: true }),
    send: (_settings, call, options = {}) =>
      new Promise<SendResult>((resolve) => {
        const entry: Pending = { call, options, resolve, text: '' }
        pending.push(entry)
        // Like the SDK: a stop returns what had arrived.
        options.signal?.addEventListener('abort', () => resolve({ status: 'aborted', partial: message(entry.text, null) }))
      }),
  }
  const last = () => pending.at(-1)!
  const emit = (event: BetaRawMessageStreamEvent) => act(() => last().options.onEvent?.(event))
  return {
    ai,
    pending,
    thinking: () => emit({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } } as never),
    startText: (index = 1) => emit({ type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } } as never),
    delta: (text: string, index = 1) => {
      last().text += text
      return emit({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } } as never)
    },
    finish: (text = last().text) => act(async () => last().resolve({ status: 'done', message: message(text, 'end_turn') })),
    fail: (problem: 'key' | 'unreachable') => act(async () => last().resolve({ status: 'failed', problem })),
  }
}

const message = (text: string, stop: BetaMessage['stop_reason']) =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'thinking', thinking: 'hm', signature: 'sig' }, ...(text ? [{ type: 'text', text, citations: null }] : [])],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as unknown as BetaMessage

async function openStep(store = readyStore({ [keys.project]: makeProject() }), driven = drivenAi()) {
  const user = userEvent.setup()
  const view = render(<Session store={store} ai={driven.ai} />)
  await user.click(await screen.findByRole('button', { name: /^1 Gruppen,/ }))
  return { user, driven, store, view, input: () => screen.getByRole('textbox', { name: 'Deine Nachricht' }) as HTMLTextAreaElement }
}

const log = () => screen.getByRole('region', { name: 'Chat' }).querySelector<HTMLElement>('.chat__log')!
const live = () => screen.getByTestId('chat-live')
/** A reload: the load runs once per store, so the new page gets a new store over the same data. */
const reloaded = (store: ReturnType<typeof memoryStore>) => memoryStore(Object.fromEntries(store.data))
const stored = async (store: ReturnType<typeof readyStore>) => (await store.get(keys.project)) as Project

describe('chat: sending and streaming', () => {
  it('Enter sends: Lukas’s turn appears, "denkt nach …" until text streams, then the text', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), 'Wir sind ein Fahrradtreff.{Enter}')
    expect(input().value).toBe('')
    expect(within(log()).getByText('Wir sind ein Fahrradtreff.')).toBeTruthy()
    expect(within(log()).getByText('denkt nach …')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stopp' })).toBeTruthy()

    driven.thinking()
    driven.startText()
    driven.delta('Danke. **Für wen** ')
    expect(within(log()).queryByText('denkt nach …')).toBeNull()
    driven.delta('seid ihr da?')
    expect(within(log()).getByText('Für wen').tagName).toBe('STRONG')
    expect(within(log()).getByText(/seid ihr da\?/)).toBeTruthy()

    await driven.finish()
    expect(screen.queryByRole('button', { name: 'Stopp' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Senden' })).toBeTruthy()
    expect(within(log()).getByText(/seid ihr da\?/)).toBeTruthy()
  })

  it('Shift+Enter makes a new line, Cmd+Enter sends; an empty input sends nothing', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), '{Enter}')
    expect(driven.pending).toHaveLength(0)
    await user.type(input(), 'Zeile 1{Shift>}{Enter}{/Shift}Zeile 2')
    expect(input().value).toBe('Zeile 1\nZeile 2')
    expect(driven.pending).toHaveLength(0)
    await user.type(input(), '{Meta>}{Enter}{/Meta}')
    expect(driven.pending).toHaveLength(1)
    expect(input().value).toBe('')
  })

  it('stores the turn and the answer; the history survives a reload', async () => {
    const { user, driven, store, view, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    driven.startText(0)
    driven.delta('Hallo zurück.', 0)
    await driven.finish()
    await waitFor(async () => expect((await stored(store)).steps[1].segments[0].messages.map((m) => m.role)).toEqual(['user', 'assistant']))
    view.unmount()
    await openStep(reloaded(store))
    expect(within(log()).getByText('Hallo')).toBeTruthy()
    expect(within(log()).getByText('Hallo zurück.')).toBeTruthy()
  })

  it('announces each finished message once, never the streamed tokens', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    driven.startText(0)
    driven.delta('Erster Teil, ', 0)
    driven.delta('zweiter Teil.', 0)
    expect(live().textContent).toBe('')
    await driven.finish()
    expect(live().textContent).toBe('Wirkungshelferin: Erster Teil, zweiter Teil.')
    // Only one live text block in the chat: the streamed bubble is not live itself.
    expect(log().querySelectorAll('[aria-live]')).toHaveLength(0)
  })
})

describe('chat: Stopp', () => {
  it('keeps the partial text marked "abgebrochen"; the next message works', async () => {
    const { user, driven, store, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    driven.thinking()
    driven.startText()
    driven.delta('Ich fange an')
    await user.click(screen.getByRole('button', { name: 'Stopp' }))
    expect(await within(log()).findByText('abgebrochen')).toBeTruthy()
    expect(within(log()).getByText('Ich fange an')).toBeTruthy()
    expect(live().textContent).toBe('Antwort abgebrochen.')
    await waitFor(async () => expect((await stored(store)).steps[1].segments[0].messages.at(-1)?.aborted).toBe(true))

    await user.type(input(), 'Weiter{Enter}')
    // The stopped answer is not part of the next request.
    const sent = driven.pending[1].call.messages
    expect(sent.map((m) => m.role)).toEqual(['user', 'user'])
    expect(JSON.stringify(sent)).not.toContain('Ich fange an')
  })

  it('a stop while thinking shows "abgebrochen" without text', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    driven.thinking()
    await user.click(screen.getByRole('button', { name: 'Stopp' }))
    expect(await within(log()).findByText('abgebrochen')).toBeTruthy()
    expect(within(log()).queryByText('denkt nach …')).toBeNull()
  })
})

describe('chat: focus stays with the input', () => {
  it('after sending by click, after Stopp and when the answer ends', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), 'Hallo')
    await user.click(screen.getByRole('button', { name: 'Senden' }))
    expect(document.activeElement).toBe(input())
    await user.click(screen.getByRole('button', { name: 'Stopp' }))
    await within(log()).findByText('abgebrochen')
    expect(document.activeElement).toBe(input())
    await user.type(input(), 'Weiter{Enter}')
    await driven.finish()
    expect(document.activeElement).toBe(input())
  })

  it('after "Erneut versuchen"; a broken stream’s text is marked "unvollständig"', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    driven.startText(0)
    driven.delta('Halber Satz', 0)
    await act(async () => driven.pending[0].resolve({ status: 'failed', problem: 'unreachable', partial: message('Halber Satz', null) }))
    expect(within(log()).getByText('unvollständig')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(document.activeElement).toBe(input())
    expect(within(log()).queryByText('unvollständig')).toBeNull()
  })
})

describe('chat: errors', () => {
  it('an invalid key: inline message with a way to the settings; the message stays', async () => {
    const { user, driven, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    await driven.fail('key')
    const alert = within(log()).getByRole('alert')
    expect(alert.textContent).toContain('Dein API-Schlüssel funktioniert nicht mehr.')
    expect(within(log()).getByText('Hallo')).toBeTruthy()
    await user.click(within(alert).getByRole('button', { name: 'Zu den Einstellungen' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeTruthy()
  })

  it('"Erneut versuchen" sends the same request again and keeps Lukas’s text', async () => {
    const { user, driven, input, store } = await openStep()
    await user.type(input(), 'Mein Text{Enter}')
    await driven.fail('unreachable')
    expect(within(log()).getByRole('alert').textContent).toContain('nicht erreichbar')
    expect(within(log()).getByText('Mein Text')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(driven.pending).toHaveLength(2)
    expect(driven.pending[1].call).toEqual(driven.pending[0].call)
    expect(within(log()).queryByRole('alert')).toBeNull()
    driven.startText(0)
    driven.delta('Jetzt klappt es.', 0)
    await driven.finish()
    await waitFor(async () => expect((await stored(store)).steps[1].segments[0].messages.map((m) => m.role)).toEqual(['user', 'assistant']))
  })

  it('after a reload with an unanswered turn, the chat offers to try again', async () => {
    const { user, driven, store, view, input } = await openStep()
    await user.type(input(), 'Hallo{Enter}')
    await driven.fail('unreachable')
    view.unmount()
    const again = drivenAi()
    const { user: user2 } = await openStep(reloaded(store), again)
    expect(within(log()).getByText(/^Darauf kam keine Antwort\./)).toBeTruthy()
    await user2.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(again.pending).toHaveLength(1)
    expect(again.pending[0].call.messages).toHaveLength(1)
    void user
  })
})

describe('chat: the input is never lost', () => {
  it('keeps the draft per step through a step switch and a reload', async () => {
    const { user, store, view, input } = await openStep()
    await user.type(input(), 'Halb fertig')
    await user.click(screen.getByRole('button', { name: /^2 Problem,/ }))
    expect(input().value).toBe('')
    await user.click(screen.getByRole('button', { name: /^1 Gruppen,/ }))
    expect(input().value).toBe('Halb fertig')
    view.unmount()
    expect(await store.get(keys.drafts)).toEqual({ 1: 'Halb fertig' })
    await openStep(reloaded(store))
    expect(input().value).toBe('Halb fertig')
  })

  it('drafts never go into the project document (and so never into a backup)', async () => {
    const { user, store, view, input } = await openStep()
    await user.type(input(), 'Geheimer Entwurf')
    view.unmount()
    expect(JSON.stringify(await store.get(keys.project))).not.toContain('Geheimer Entwurf')
  })
})

describe('Markdown is inert', () => {
  const html = (md: string) => {
    const { container } = render(<Markdown>{md}</Markdown>)
    return container
  }

  it.each([
    ['<script>alert(1)</script>', '<script>alert(1)</script>'],
    ['<img src=x onerror="alert(1)">', '<img src=x onerror="alert(1)">'],
  ])('raw HTML %s shows as text', (md, text) => {
    const el = html(md)
    expect(el.querySelector('script, img')).toBeNull()
    expect(el.textContent).toContain(text)
  })

  it('a javascript: link and a data: link are plain text', () => {
    const el = html('[klick](javascript:alert(1)) und [daten](data:text/html,<b>x</b>) und <javascript:alert(2)>')
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toContain('klick')
    expect(el.textContent).toContain('daten')
  })

  it('a Markdown image is text, never an image', () => {
    const el = html('![Logo](https://example.org/logo.png)')
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toBe('[Bild: Logo]')
  })

  it('https links open in a new tab without access to the app', () => {
    const el = html('[Quelle](https://example.org/a) und http://example.org/b')
    const links = el.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://example.org/a')
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
  })
})
