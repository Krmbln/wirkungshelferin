import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AiClient, SendOptions, SendResult } from '../../src/ai/client'
import type { Call } from '../../src/ai/request'
import { makeProject, makeProjectWithStatuses, makeProposal } from '../../src/domain/fixtures'
import { markActive, withResume } from '../../src/domain/resume'
import type { Project } from '../../src/domain/schemas/project'
import { defaultSettings } from '../../src/storage/settings'
import { keys, memoryStore } from '../../src/storage/store'
import { App } from '../../src/ui/App'
import { CARD_LIMITS, homeCard, plainText, questionOf, rowStatus } from '../../src/ui/home'
import { Session } from '../../src/ui/Session'
import { recommendedStep, statusesOf } from '../../src/ui/steps'
import { dummyKey } from '../dummyKey'
import { resumeAnswer, withChat } from '../resume'

// Home complete (implementation plan step 22, design §6.1 "Step 22").

const T1 = '2026-11-10T10:00:00.000Z'
const T2 = '2026-11-10T10:05:00.000Z'
const NOW = new Date('2026-11-10T15:00:00.000Z')

/** Step 2 with a short chat that ends in a question. */
const chatted = (p: Project = makeProject({ steps: { 2: { status: 'in_progress' } } })) =>
  withChat(p, 2, [
    { role: 'user', text: 'Die Räder sind oft kaputt.', at: T1 },
    { role: 'assistant', text: 'Das hilft. Woran liegt es **meistens**? Erzähl ruhig.', at: T1 },
  ])

describe('the card’s states (pure)', () => {
  it('A: nothing started → step 0, "Hier fängst du an"', () => {
    expect(homeCard(makeProject())).toEqual({ kind: 'next', step: 0, body: { kind: 'lead' }, fresh: true })
  })

  it('without a last active step but with progress (an older project) → the recommended step, not fresh', () => {
    const card = homeCard(makeProjectWithStatuses({ 0: 'confirmed', 1: 'in_progress' }))
    expect(card).toMatchObject({ kind: 'next', step: 1, fresh: false })
  })

  it('B: a current summary', () => {
    const p = markActive(chatted(), 2, T2)
    const card = homeCard(withResume(p, 2, { summary: 'Zwei Ursachen stehen.', nextAction: 'Beantworte die Frage im Chat.', at: T2 }))
    expect(card).toEqual({ kind: 'resume', step: 2, body: { kind: 'summary', summary: 'Zwei Ursachen stehen.', nextAction: 'Beantworte die Frage im Chat.' } })
  })

  it('B: Markdown in the summary is stripped (the prompt forbids it; the card doesn’t rely on that)', () => {
    const p = withResume(markActive(chatted(), 2, T2), 2, { summary: 'Zwei **Ursachen** stehen.', nextAction: 'Sieh dir [Schritt 1](#s1) an.', at: T2 })
    expect(homeCard(p)).toMatchObject({ body: { kind: 'summary', summary: 'Zwei Ursachen stehen.', nextAction: 'Sieh dir Schritt 1 an.' } })
  })

  it('C: no summary → the last answer’s last question, as plain text', () => {
    expect(homeCard(markActive(chatted(), 2, T2))).toEqual({ kind: 'resume', step: 2, body: { kind: 'question', question: 'Woran liegt es meistens?' } })
  })

  it('C: an outdated summary falls back too', () => {
    const p = withResume(markActive(chatted(), 2, T2), 2, { summary: 'alt', nextAction: 'alt', at: T1 })
    expect(homeCard(p)).toMatchObject({ body: { kind: 'question' } })
  })

  it('C: the card question of the last answer wins (step 18b), links stripped', () => {
    const base = withChat(makeProject({ steps: { 2: { status: 'in_progress' } } }), 2, [
      { role: 'user', text: 'Mach mal.', at: T1 },
      { role: 'assistant', text: 'Hier ein Vorschlag. Passt das?', at: T1, toolUseId: 'tu1' },
    ])
    base.steps[2].proposals = [{ ...makeProposal([], { question: 'Passt das zu [Schritt 1](#schritt-1)?' }), toolUseId: 'tu1' }]
    expect(homeCard(markActive(base, 2, T2))).toMatchObject({ body: { kind: 'question', question: 'Passt das zu Schritt 1?' } })
  })

  it('C: Lukas’s last message has no answer (failed or stopped) → no stale question', () => {
    const failed = withChat(chatted(), 2, [
      { role: 'assistant', text: 'Woran liegt es?', at: T1 },
      { role: 'user', text: 'Am Werkzeug.', at: T2 },
    ])
    expect(homeCard(markActive(failed, 2, T2))).toMatchObject({ body: { kind: 'unanswered' } })
    const stopped = withChat(chatted(), 2, [
      { role: 'user', text: 'Am Werkzeug.', at: T2 },
      { role: 'assistant', text: 'Dann', at: T2, aborted: true },
    ])
    expect(homeCard(markActive(stopped, 2, T2))).toMatchObject({ body: { kind: 'unanswered' } })
  })

  it('C: an answer without a question, or no chat at all → the step’s lead', () => {
    const plain = withChat(chatted(), 2, [{ role: 'assistant', text: 'Gut so.', at: T1 }])
    expect(homeCard(markActive(plain, 2, T2))).toMatchObject({ body: { kind: 'lead' } })
    expect(homeCard(markActive(makeProject({ steps: { 2: { status: 'in_progress' } } }), 2, T2))).toMatchObject({ kind: 'resume', body: { kind: 'lead' } })
  })

  it('a long summary is cut at a word boundary, never mid-word', () => {
    const long = 'Wort '.repeat(100).trim()
    const card = homeCard(withResume(markActive(chatted(), 2, T2), 2, { summary: long, nextAction: long, at: T2 }))
    if (card.kind !== 'resume' || card.body.kind !== 'summary') throw new Error('expected a summary')
    expect(card.body.summary.length).toBeLessThanOrEqual(CARD_LIMITS.summary)
    expect(card.body.summary).toMatch(/Wort …$/)
    expect(card.body.nextAction.length).toBeLessThanOrEqual(CARD_LIMITS.nextAction)
  })

  it('E: the last active step is confirmed → the recommended step and the confirmed line', () => {
    const p = markActive(makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed' }), 2, T2)
    expect(homeCard(p)).toMatchObject({ kind: 'next', step: 3, body: { kind: 'lead' }, fresh: false, confirmed: { step: 2 } })
  })

  it('E: a recommended step that may be outdated says so; one in Arbeit with a chat shows its question', () => {
    const stale = markActive(makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'maybe_outdated' }), 2, T2)
    expect(homeCard(stale)).toMatchObject({ step: 3, body: { kind: 'outdated' } })
    const working = chatted(makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'in_progress', 3: 'confirmed' }))
    expect(homeCard(markActive(working, 3, T2))).toMatchObject({ kind: 'next', step: 2, body: { kind: 'question' } })
  })

  it('F: all confirmed', () => {
    const all = makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'confirmed', 4: 'confirmed', 5: 'confirmed', 6: 'confirmed' })
    expect(homeCard(markActive(all, 6, T2))).toEqual({ kind: 'done' })
  })
})

describe('recommendation and status lines', () => {
  it('the first step in method order that isn’t confirmed; outdated and in Arbeit count as not', () => {
    expect(recommendedStep(statusesOf(makeProjectWithStatuses({ 0: 'confirmed', 1: 'maybe_outdated', 2: 'confirmed' })))).toBe(1)
    // Lukas jumped ahead: the card names step 3, the chip step 1.
    const ahead = markActive(chatted(makeProjectWithStatuses({ 0: 'confirmed', 3: 'in_progress' })), 3, T2)
    expect(recommendedStep(statusesOf(ahead))).toBe(1)
    expect(homeCard(ahead)).toMatchObject({ kind: 'resume', step: 3 })
  })

  it('a confirmed row carries its day: heute / gestern / am 05.11. / with the year', () => {
    const p = makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'confirmed', 4: 'in_progress', 5: 'maybe_outdated' })
    p.steps[0].confirmed!.at = '2026-11-10T09:00:00.000Z'
    p.steps[1].confirmed!.at = '2026-11-09T09:00:00.000Z'
    p.steps[2].confirmed!.at = '2026-11-05T09:00:00.000Z'
    p.steps[3].confirmed!.at = '2025-12-24T09:00:00.000Z'
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => rowStatus(p, s as never, NOW))).toEqual([
      'bestätigt heute',
      'bestätigt gestern',
      'bestätigt am 05.11.',
      'bestätigt am 24.12.2025',
      'in Arbeit',
      'vielleicht veraltet – prüfen',
      'noch nicht begonnen',
    ])
  })

  it('plainText strips links, emphasis and list marks', () => {
    expect(plainText('- **Was** meinst du mit [Schritt 2](#s2) und `x`?')).toBe('Was meinst du mit Schritt 2 und x?')
  })

  it('questionOf takes the last sentence ending in "?"', () => {
    const p = withChat(makeProject(), 2, [{ role: 'assistant', text: 'Erst das? Nein.\n\nDann: Wer repariert die Räder? Danke.', at: T1 }])
    expect(questionOf(p.steps[2].segments[0].messages[0], [])).toBe('Dann: Wer repariert die Räder?')
  })
})

describe('the card on screen', () => {
  const resumeCard = () => screen.getByRole('region', { name: /Wo du aufgehört hast|Als Nächstes|Hier fängst du an/ })

  it('B shows summary and "Zum Weitermachen:"; Weiter names the step', () => {
    const p = withResume(markActive(chatted(), 2, T2), 2, { summary: 'Zwei Ursachen stehen.', nextAction: 'Beantworte die Frage im Chat.', at: T2 })
    const { container } = render(<App project={p} now={NOW} />)
    expect(resumeCard().textContent).toContain('Wo du aufgehört hast')
    expect(resumeCard().textContent).toContain('Zum Weitermachen: Beantworte die Frage im Chat.')
    expect(container.querySelectorAll('.btn--primary')).toHaveLength(1)
    const weiter = screen.getByRole('button', { name: 'Weiter' })
    expect(document.getElementById(weiter.getAttribute('aria-describedby')!)!.textContent).toMatch(/^Schritt 2 · /)
  })

  it('D → B: the summary lands in place; Weiter stays the same element and keeps focus', () => {
    const p = markActive(chatted(), 2, T2)
    const { rerender } = render(<App project={p} now={NOW} resume={{ writing: 2, write: () => {} }} />)
    expect(resumeCard().textContent).toContain('Zuletzt hat die Wirkungshelferin gefragt:')
    expect(resumeCard().textContent).toContain('fasst zusammen, wo du stehst …')
    // Nothing announced: Lukas didn't ask for it.
    expect(resumeCard().querySelector('[role="status"]')).toBeNull()
    const weiter = screen.getByRole('button', { name: 'Weiter' })
    weiter.focus()
    rerender(<App project={withResume(p, 2, { summary: 'Zwei Ursachen stehen.', nextAction: 'Beantworte die Frage.', at: T2 })} now={NOW} resume={{ write: () => {} }} />)
    expect(resumeCard().textContent).toContain('Zwei Ursachen stehen.')
    expect(resumeCard().textContent).not.toContain('fasst zusammen')
    expect(screen.getByRole('button', { name: 'Weiter' })).toBe(weiter)
    expect(document.activeElement).toBe(weiter)
  })

  it('E shows "Schritt 2 hast du heute bestätigt." and Weiter opens the recommended step', async () => {
    const p = markActive(makeProjectWithStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed' }), 2, T2)
    p.steps[2].confirmed!.at = '2026-11-10T09:00:00.000Z'
    render(<App project={p} now={NOW} />)
    expect(resumeCard().textContent).toContain('Als Nächstes')
    expect(resumeCard().textContent).toContain('Schritt 2 hast du heute bestätigt.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Weiter' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wirkungsziele')
  })
})

// ------------------------------------------------------------ the trigger, through Session

type Pending = { call: Call; resolve: (r: SendResult) => void; options: SendOptions }

/** Chat turns answer at once unless held; resume calls (the ones with a format) wait for the test. */
function fakeAi({ holdChat = false } = {}) {
  const resumes: Pending[] = []
  const chats: Pending[] = []
  const ai: AiClient = {
    testConnection: async () => ({ ok: true }),
    send: (_settings, call, options = {}) =>
      new Promise<SendResult>((resolve) => {
        const entry = { call, resolve, options }
        if (call.format) return resumes.push(entry)
        if (holdChat) return chats.push(entry)
        resolve({ status: 'done', message: resumeAnswer('Verstanden. Wer hilft euch dabei?') })
      }),
  }
  return { ai, resumes, chats }
}

const storeWith = (project: Project, { key = true } = {}) =>
  memoryStore({ [keys.settings]: { ...defaultSettings, setupDone: true, ...(key && { apiKey: dummyKey }) }, [keys.project]: project })
const storedProject = async (store: ReturnType<typeof memoryStore>) => (await store.get(keys.project)) as Project
const row = (n: number) => screen.findByRole('button', { name: new RegExp(`^${n} [A-Za-zä]+,`) })

async function workInStep2(fake = fakeAi(), project = chatted()) {
  const user = userEvent.setup()
  const store = storeWith(project)
  render(<Session store={store} ai={fake.ai} />)
  await user.click(await row(2))
  const input = screen.getByRole('textbox', { name: 'Deine Nachricht' })
  await user.type(input, 'Am Werkzeug.{Enter}')
  return { user, store, fake }
}

describe('when the summary is written (Session)', () => {
  it('not while Lukas is in the step, not on tab close — on navigation (plan test)', async () => {
    const { user, store, fake } = await workInStep2()
    await waitFor(async () => expect((await storedProject(store)).lastActive?.stepId).toBe(2))
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fake.resumes).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Übersicht' }))
    await waitFor(() => expect(fake.resumes).toHaveLength(1))
    expect(fake.resumes[0].call.effort).toBe('low')
    // D while it is written: the fallback is the answer that just came.
    expect(screen.getByText('Wer hilft euch dabei?')).toBeTruthy()
    expect(screen.getByText('fasst zusammen, wo du stehst …')).toBeTruthy()
    await act(async () => fake.resumes[0].resolve({ status: 'done', message: resumeAnswer({ summary: 'Werkzeug fehlt.', nextAction: 'Sag, wer euch hilft.' }) }))
    expect(await screen.findByText('Werkzeug fehlt.')).toBeTruthy()
    const saved = await storedProject(store)
    expect(saved.steps[2].resume).toMatchObject({ summary: 'Werkzeug fehlt.', nextAction: 'Sag, wer euch hilft.' })
    // Going to another step and back home doesn't write it again: nothing new happened.
    await user.click(await row(3))
    await user.click(screen.getByRole('button', { name: 'Übersicht' }))
    expect(fake.resumes).toHaveLength(1)
  })

  it('waits for a running answer, so the summary includes it', async () => {
    const fake = fakeAi({ holdChat: true })
    const { user } = await workInStep2(fake)
    await user.click(screen.getByRole('button', { name: 'Übersicht' }))
    expect(fake.resumes).toHaveLength(0)
    await act(async () => fake.chats[0].resolve({ status: 'done', message: resumeAnswer('Und wer hilft?') }))
    await waitFor(() => expect(fake.resumes).toHaveLength(1))
    expect(fake.resumes[0].call.messages[0].content).toContain('Und wer hilft?')
  })

  it('an answer landing in the background doesn’t make its step the last active one', async () => {
    const fake = fakeAi({ holdChat: true })
    const { user, store } = await workInStep2(fake)
    // Lukas only looks at step 3 while step 2's answer lands: step 2 stays where he left off.
    await user.click(await row(3))
    await act(async () => fake.chats[0].resolve({ status: 'done', message: resumeAnswer('Und wer hilft?') }))
    await waitFor(async () => expect((await storedProject(store)).steps[2].segments[0].messages.at(-1)?.role).toBe('assistant'))
    expect((await storedProject(store)).lastActive?.stepId).toBe(2)
    // He works in step 3 while another step 2 answer runs; it lands in the background.
    await user.click(await row(2))
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Noch was.{Enter}')
    await user.click(await row(3))
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Neues Ziel.{Enter}')
    await waitFor(async () => expect((await storedProject(store)).lastActive?.stepId).toBe(3))
    await act(async () => fake.chats[1].resolve({ status: 'done', message: resumeAnswer('Und sonst?') }))
    await waitFor(async () => expect((await storedProject(store)).steps[2].segments[0].messages.at(-1)?.role).toBe('assistant'))
    expect((await storedProject(store)).lastActive?.stepId).toBe(3)
  })

  it('at the next start, a summary still due is written (Lukas closed the tab in the step)', async () => {
    const fake = fakeAi()
    render(<Session store={storeWith(markActive(chatted(), 2, T2))} ai={fake.ai} />)
    await waitFor(() => expect(fake.resumes).toHaveLength(1))
  })

  it('without a key nothing is sent and the fallback stays', async () => {
    const fake = fakeAi()
    render(<Session store={storeWith(markActive(chatted(), 2, T2), { key: false })} ai={fake.ai} />)
    expect(await screen.findByText('Woran liegt es meistens?')).toBeTruthy()
    expect(fake.resumes).toHaveLength(0)
  })

  it('a failure shows no error, keeps the fallback and isn’t retried until new work', async () => {
    const fake = fakeAi()
    const user = userEvent.setup()
    render(<Session store={storeWith(markActive(chatted(), 2, T2))} ai={fake.ai} />)
    await waitFor(() => expect(fake.resumes).toHaveLength(1))
    await act(async () => fake.resumes[0].resolve({ status: 'failed', problem: 'unreachable' }))
    expect(screen.queryByText('fasst zusammen, wo du stehst …')).toBeNull()
    expect(screen.getByText('Woran liegt es meistens?')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(await row(3))
    await user.click(screen.getByRole('button', { name: 'Übersicht' }))
    expect(fake.resumes).toHaveLength(1)
    // New work in step 2 makes it due again.
    await user.click(await row(2))
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), 'Noch was.{Enter}')
    await user.click(screen.getByRole('button', { name: 'Übersicht' }))
    await waitFor(() => expect(fake.resumes).toHaveLength(2))
  })
})

