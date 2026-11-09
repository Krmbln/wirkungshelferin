import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AiClient, SendResult } from '../../src/ai/client'
import type { Call } from '../../src/ai/request'
import { makeItem, makeProject, makeProposal } from '../../src/domain/fixtures'
import { reducer } from '../../src/domain/reducer'
import type { Project, Proposal, StoredMessage } from '../../src/domain/schemas/project'
import { keys, memoryStore } from '../../src/storage/store'
import { App } from '../../src/ui/App'
import { blockedText, openProposals, proposalRows, rowText, staleText } from '../../src/ui/proposals/describe'
import { HIGHLIGHT_MS } from '../../src/ui/proposals/highlight'
import { Session } from '../../src/ui/Session'
import { readyStore } from '../stores'

// Proposal card and "Übernehmen" (implementation plan step 12, design §6.2). Card behaviour
// against App + reducer; the tool_result round trip against Session with a hand-driven client.

const at = '2026-11-04T11:40:00.000Z'

/** A step 1 project with a chat whose last answer carries the proposal. */
function withProposal(proposal: Proposal, block?: Partial<Project['steps'][1]['block']>): Project {
  const p = makeProject({
    steps: {
      1: {
        status: 'in_progress',
        proposals: [proposal],
        block: {
          challenge: makeItem(1, 'challenge', { text: 'Zu wenig Orte am Nachmittag' }),
          targetGroups: [makeItem(1, 'targetGroups', { name: 'Eltern', description: 'holen ab', reach: 'indirect' }, { id: 'tg1' })],
          stakeholders: [makeItem(1, 'stakeholders', { role: 'Schule nebenan', expectations: [] }, { id: 'sh1' })],
          ...block,
        },
      },
    },
  })
  const messages: StoredMessage[] = [
    { id: 'm1', at, role: 'user', content: [{ type: 'text', text: 'Hallo' }] },
    {
      id: 'm2',
      at,
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hier ist mein Vorschlag.' },
        { type: 'tool_use', id: proposal.toolUseId, name: 'propose_changes', input: {} },
      ],
    },
  ]
  p.steps[1].segments = [{ id: 's1', startedAt: at, messages }]
  return p
}

const groupFields = { name: 'Jugendliche 12–17', description: 'aus der Siedlung', reach: 'direct', isFocus: true, why: 'Hier wirkt das Projekt.' }

const mixed = () =>
  makeProposal(
    [
      { op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: groupFields },
      { op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { reach: 'direct' } },
      { op: 'remove', collection: 'stakeholders', targetId: 'sh1', baseRev: 1 },
    ],
    { summary: 'Jugendliche aufnehmen, Eltern direkt, Schule raus.' },
  )

let latest: Project
function Harness({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial)
  latest = project
  return <App project={project} initialView={{ kind: 'step', step: 1 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} />
}

function open(project: Project) {
  const user = userEvent.setup()
  render(<Harness initial={project} />)
  return { user, card: () => within(screen.getByRole('article', { name: 'Vorschlag' })) }
}

const item = (id: string) => document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)
const blockPanel = () => within(screen.getByRole('region', { name: 'Baustein' }))

describe('proposal rows: what they say', () => {
  it('NEU: noun, name, short facts, the other fields as details', () => {
    const p = mixed()
    const project = withProposal(p)
    const text = rowText(project, 1, p, p.changes[0], { kind: 'open' })
    expect(text).toMatchObject({ kind: 'new', noun: 'Zielgruppe', main: 'Jugendliche 12–17', meta: ['direkt', 'Fokusgruppe'] })
    expect(text.fields).toEqual([
      { label: 'Beschreibung', after: 'aus der Siedlung' },
      { label: 'Warum?', after: 'Hier wirkt das Projekt.' },
    ])
  })

  it('ÄNDERN: the item by its current name, each changed field old → new; after applying, the old values stay', () => {
    const p = mixed()
    let project = withProposal(p)
    const text = rowText(project, 1, p, p.changes[1], { kind: 'open' })
    expect(text).toMatchObject({ kind: 'change', main: 'Eltern', fields: [{ label: 'Erreicht', before: 'indirekt', after: 'direkt' }] })
    project = reducer(project, { type: 'change/apply', step: 1, proposalId: 'p1', changeId: 'p1c2' })
    const after = project.steps[1].proposals[0]
    expect(rowText(project, 1, after, after.changes[1], { kind: 'applied' }).fields).toEqual([{ label: 'Erreicht', before: 'indirekt', after: 'direkt' }])
  })

  it('never shows an internal id: an empty singleton is named by its noun, an unnamed item as such', () => {
    const p = makeProposal([
      { op: 'update', collection: 'challenge', targetId: 'challenge', baseRev: 1, fields: { text: 'Kaum Orte am Nachmittag' } },
      { op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { sizeEstimate: 'etwa 20' } },
    ])
    const project = withProposal(p, { challenge: makeItem(1, 'challenge', { text: '' }), targetGroups: [makeItem(1, 'targetGroups', { name: '' }, { id: 'tg1' })] })
    expect(rowText(project, 1, p, p.changes[0], { kind: 'open' })).toMatchObject({ noun: 'Herausforderung', main: '', fields: [{ label: 'Herausforderung', before: '', after: 'Kaum Orte am Nachmittag' }] })
    expect(rowText(project, 1, p, p.changes[1], { kind: 'open' }).main).toBe('Zielgruppe ohne Namen')
  })

  it('a dependent update shows only what differs from the add (even with the tool’s full field set)', () => {
    const p = makeProposal([
      { op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: { ...groupFields, sizeEstimate: '' } },
      { op: 'update', collection: 'targetGroups', targetId: 'new:1', fields: { ...groupFields, sizeEstimate: 'etwa 15' } },
    ])
    const project = withProposal(p)
    expect(rowText(project, 1, p, p.changes[1], { kind: 'blocked', needs: 'p1c1' }).fields).toEqual([{ label: 'Größe', before: '', after: 'etwa 15' }])
  })

  it('ENTFERNEN keeps the name after the item is gone', () => {
    const p = mixed()
    let project = withProposal(p)
    project = reducer(project, { type: 'change/apply', step: 1, proposalId: 'p1', changeId: 'p1c3' })
    const after = project.steps[1].proposals[0]
    expect(rowText(project, 1, after, after.changes[2], { kind: 'applied' })).toMatchObject({ kind: 'remove', noun: 'Beteiligte', main: 'Schule nebenan' })
  })

  it('stale reasons in plain words; a dependent change names its creator', () => {
    const p = makeProposal([
      { op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: groupFields },
      { op: 'update', collection: 'targetGroups', targetId: 'new:1', fields: { sizeEstimate: 'etwa 15' } },
    ])
    let project = withProposal(p)
    expect(blockedText(project, 1, p, 'p1c1')).toBe('zuerst ‚Neu: Jugendliche 12–17‘ übernehmen')
    expect(staleText(project, 1, p, p.changes[0], 'removed')).toBe('gibt es nicht mehr')
    project = reducer(project, { type: 'item/edit', step: 1, collection: 'targetGroups', id: 'tg1', fields: { name: 'Eltern und Großeltern' } })
    const edit = makeProposal([{ op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { reach: 'direct' } }])
    expect(staleText(project, 1, edit, edit.changes[0], 'edited')).toBe('du hast das inzwischen geändert')
  })

  it('counts open changes (dependent ones too) and finds the oldest proposal that has one', () => {
    const p = mixed()
    const project = withProposal(p)
    expect(openProposals(project, 1)).toEqual({ count: 3, first: 'p1' })
    const done = reducer(project, { type: 'change/applyAll', step: 1, proposalId: 'p1' })
    expect(openProposals(done, 1)).toEqual({ count: 0, first: undefined })
    expect(proposalRows(done, 1, done.steps[1].proposals[0]).map((r) => [r.view.kind, r.undoable])).toEqual([
      ['applied', true],
      ['applied', true],
      ['applied', true],
    ])
  })
})

describe('proposal card: Übernehmen, Ablehnen, Rückgängig', () => {
  it('shows summary and one row per change with chip and buttons; "Alle übernehmen" with ≥ 2 open', () => {
    const { card } = open(withProposal(mixed()))
    expect(card().getByText('Jugendliche aufnehmen, Eltern direkt, Schule raus.')).toBeTruthy()
    expect(card().getAllByRole('button', { name: /^Übernehmen:/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Übernehmen: Neu – Zielgruppe „Jugendliche 12–17“',
      'Übernehmen: Ändern – Zielgruppe „Eltern“',
      'Übernehmen: Entfernen – Beteiligte „Schule nebenan“',
    ])
    expect(card().getByRole('button', { name: 'Alle übernehmen' })).toBeTruthy()
    // ÄNDERN: old value struck through, new one follows.
    expect(card().getByText('indirekt').closest('del')).toBeTruthy()
  })

  it('Übernehmen puts the item into the block, marks the row and moves focus to its Rückgängig', async () => {
    const { user, card } = open(withProposal(mixed()))
    await user.click(card().getByRole('button', { name: 'Übernehmen: Neu – Zielgruppe „Jugendliche 12–17“' }))
    expect(latest.steps[1].block.targetGroups.map((g) => g.name)).toEqual(['Eltern', 'Jugendliche 12–17'])
    expect(latest.steps[1].block.targetGroups[1].editedByUser).toBe(false)
    const row = card().getByText('Jugendliche 12–17').closest('li')!
    expect(within(row).getByText('übernommen')).toBeTruthy()
    expect(document.activeElement).toBe(within(row).getByRole('button', { name: /^Rückgängig:/ }))
    // The new item lights up in the block once the scroll is there, and goes again after 1.5 s.
    await waitFor(() => expect(item('tg2')!.hasAttribute('data-highlight')).toBe(true))
    await waitFor(() => expect(item('tg2')!.hasAttribute('data-highlight')).toBe(false), { timeout: HIGHLIGHT_MS + 1000 })
  })

  it('Rückgängig after Übernehmen takes the item out again and offers Übernehmen once more', async () => {
    const { user, card } = open(withProposal(mixed()))
    await user.click(card().getByRole('button', { name: 'Übernehmen: Entfernen – Beteiligte „Schule nebenan“' }))
    expect(latest.steps[1].block.stakeholders).toEqual([])
    await user.click(card().getByRole('button', { name: 'Rückgängig: Entfernen – Beteiligte „Schule nebenan“' }))
    expect(latest.steps[1].block.stakeholders.map((s) => s.role)).toEqual(['Schule nebenan'])
    expect(document.activeElement).toBe(card().getByRole('button', { name: 'Übernehmen: Entfernen – Beteiligte „Schule nebenan“' }))
  })

  it('Ablehnen leaves the block alone, shows "abgelehnt", and Rückgängig opens it again', async () => {
    const { user, card } = open(withProposal(mixed()))
    const before = latest.steps[1].block
    await user.click(card().getByRole('button', { name: 'Ablehnen: Ändern – Zielgruppe „Eltern“' }))
    expect(latest.steps[1].block).toEqual(before)
    expect(card().getByText('abgelehnt')).toBeTruthy()
    await user.click(card().getByRole('button', { name: 'Rückgängig: Ändern – Zielgruppe „Eltern“' }))
    expect(card().getByRole('button', { name: 'Übernehmen: Ändern – Zielgruppe „Eltern“' })).toBeTruthy()
  })

  it('"Alle übernehmen" applies every open change, also dependent ones, and then goes', async () => {
    const p = makeProposal([
      { op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: groupFields },
      { op: 'update', collection: 'targetGroups', targetId: 'new:1', fields: { sizeEstimate: 'etwa 15' } },
    ])
    const { user, card } = open(withProposal(p))
    // The dependent row waits for its creator and says so.
    expect(card().getByText('zuerst ‚Neu: Jugendliche 12–17‘ übernehmen')).toBeTruthy()
    await user.click(card().getByRole('button', { name: 'Alle übernehmen' }))
    expect(latest.steps[1].block.targetGroups[1]).toMatchObject({ name: 'Jugendliche 12–17', sizeEstimate: 'etwa 15' })
    expect(card().queryByRole('button', { name: 'Alle übernehmen' })).toBeNull()
    expect(card().getAllByText('übernommen')).toHaveLength(2)
  })

  it('one open change: no "Alle übernehmen"', () => {
    const p = makeProposal([{ op: 'update', collection: 'challenge', targetId: 'challenge', baseRev: 1, fields: { why: 'Darum.' } }])
    const { card } = open(withProposal(p))
    expect(card().queryByRole('button', { name: 'Alle übernehmen' })).toBeNull()
  })

  it('an unknown target is VERALTET without buttons', () => {
    const p = makeProposal([{ op: 'update', collection: 'targetGroups', targetId: 'tg9', baseRev: 1, fields: { reach: 'direct' } }])
    const { card } = open(withProposal(p))
    expect(card().getByText('Veraltet')).toBeTruthy()
    expect(card().getByText('Eintrag nicht gefunden')).toBeTruthy()
    expect(card().queryByRole('button', { name: /^Übernehmen/ })).toBeNull()
  })

  it('a hand edit makes the open change on that item VERALTET; the edit stays', async () => {
    const p = makeProposal([{ op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { reach: 'direct' } }])
    const { user, card } = open(withProposal(p))
    const name = blockPanel().getByRole('textbox', { name: 'Name der Zielgruppe' })
    await user.clear(name)
    await user.type(name, 'Eltern und Großeltern{Enter}')
    expect(card().getByText('du hast das inzwischen geändert')).toBeTruthy()
    expect(card().queryByRole('button', { name: /^Übernehmen/ })).toBeNull()
    expect(latest.steps[1].block.targetGroups[0]).toMatchObject({ name: 'Eltern und Großeltern', reach: 'indirect' })
  })

  it('hovering or focusing a row outlines its item in the block', async () => {
    const { user, card } = open(withProposal(mixed()))
    const row = card().getByText('Schule nebenan').closest('li')!
    await user.hover(row)
    expect(item('sh1')!.hasAttribute('data-outlined')).toBe(true)
    await user.unhover(row)
    expect(item('sh1')!.hasAttribute('data-outlined')).toBe(false)
    act(() => within(row).getByRole('button', { name: /^Übernehmen/ }).focus())
    expect(item('sh1')!.hasAttribute('data-outlined')).toBe(true)
  })

  it('Details shows the fields a NEU row would set', async () => {
    const { user, card } = open(withProposal(mixed()))
    const toggle = card().getByRole('button', { name: 'Details' })
    expect(card().getByText('aus der Siedlung').closest('dl')!.hidden).toBe(true)
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(card().getByText('aus der Siedlung').closest('dl')!.hidden).toBe(false)
  })
})

describe('block panel: "offene Änderungen im Chat"', () => {
  it('counts the open changes, jumps to the card, and goes when none are left', async () => {
    const { user, card } = open(withProposal(mixed()))
    const line = blockPanel().getByRole('button', { name: '3 offene Änderungen im Chat' })
    await user.click(line)
    const region = screen.getByRole('article', { name: 'Vorschlag' })
    expect(document.activeElement).toBe(region)
    expect(region.hasAttribute('data-highlight')).toBe(true)
    await user.click(card().getByRole('button', { name: 'Alle übernehmen' }))
    expect(blockPanel().queryByRole('button', { name: /im Chat$/ })).toBeNull()
  })

  it('one open change reads in the singular', () => {
    const p = makeProposal([{ op: 'remove', collection: 'stakeholders', targetId: 'sh1', baseRev: 1 }])
    open(withProposal(p))
    expect(blockPanel().getByRole('button', { name: '1 offene Änderung im Chat' })).toBeTruthy()
  })
})

// ---- The tool_result round trip, through Session ---------------------------------------

type Sent = { call: Call; resolve: (r: SendResult) => void }

function drivenAi() {
  const sent: Sent[] = []
  const ai: AiClient = {
    testConnection: async () => ({ ok: true }),
    send: (_settings, call) => new Promise<SendResult>((resolve) => sent.push({ call, resolve })),
  }
  const answer = (content: unknown[]) =>
    act(async () =>
      sent.at(-1)!.resolve({
        status: 'done',
        message: { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: content.some((b) => (b as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as BetaMessage,
      }),
    )
  return { ai, sent, answer }
}

const proposeUse = (id: string, input: unknown) => ({ type: 'tool_use', id, name: 'propose_changes', input })
const addGroup = { summary: 'Jugendliche aufnehmen.', question: 'Passt das so?', changes: [{ op: 'add', collection: 'targetGroups', id: 'new:1', fields: { ...groupFields, sizeEstimate: '' } }] }

async function openSession(store = readyStore({ [keys.project]: makeProject() }), driven = drivenAi()) {
  const user = userEvent.setup()
  render(<Session store={store} ai={driven.ai} />)
  await user.click(await screen.findByRole('button', { name: /^1 Gruppen,/ }))
  const send = async (text: string) => {
    await user.type(screen.getByRole('textbox', { name: 'Deine Nachricht' }), `${text}{Enter}`)
  }
  return { user, driven, store, send }
}

const reloaded = (store: ReturnType<typeof memoryStore>) => memoryStore(Object.fromEntries(store.data))
const toolResults = (call: Call) =>
  (call.messages.at(-1)!.content as { type: string; tool_use_id?: string; content?: string; is_error?: boolean }[]).filter((b) => b.type === 'tool_result')

describe('proposals through the chat (Session)', () => {
  it('a proposal becomes a card; after Übernehmen the next request answers it with "übernommen" and the new id', async () => {
    const { user, driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([{ type: 'text', text: 'Dann nehme ich sie auf.' }, proposeUse('toolu_1', addGroup)])
    const card = within(await screen.findByRole('article', { name: 'Vorschlag' }))
    await user.click(card.getByRole('button', { name: /^Übernehmen: Neu/ }))
    await send('Passt.')
    expect(toolResults(driven.sent[1].call)).toEqual([expect.objectContaining({ tool_use_id: 'toolu_1', content: expect.stringContaining('übernommen, neue ID tg1') })])
  })

  it('reload with an open proposal: the card is back and the next request carries its result ("offen")', async () => {
    const first = await openSession()
    await first.send('Für Jugendliche.')
    await first.driven.answer([proposeUse('toolu_1', addGroup)])
    await screen.findByRole('article', { name: 'Vorschlag' })
    await waitFor(async () => expect(((await first.store.get(keys.project)) as Project).steps[1].proposals).toHaveLength(1))
    document.body.innerHTML = ''

    const again = await openSession(reloaded(first.store))
    expect(await screen.findByRole('button', { name: /^Übernehmen: Neu/ })).toBeTruthy()
    await again.send('Weiter.')
    expect(toolResults(again.driven.sent[0].call)).toEqual([expect.objectContaining({ tool_use_id: 'toolu_1', content: expect.stringContaining(': offen') })])
  })

  it('malformed tool input: no card, and the next request carries an error result', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([{ type: 'text', text: 'Moment.' }, proposeUse('toolu_bad', { summary: 'kaputt', question: 'Passt das so?', changes: [{ op: 'add', collection: 'targetGroups', id: 'tg5', fields: { name: 1 } }] })])
    await screen.findByText('Moment.')
    expect(screen.queryByRole('article', { name: 'Vorschlag' })).toBeNull()
    await send('Und?')
    expect(toolResults(driven.sent[1].call)).toEqual([expect.objectContaining({ tool_use_id: 'toolu_bad', is_error: true })])
  })

  it('tool input that isn’t an object at all (a cut-off string): no card, an error result', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([{ type: 'text', text: 'Abgeschnitten.' }, proposeUse('toolu_cut', '{"summary": "Jugendl')])
    await screen.findByText('Abgeschnitten.')
    expect(screen.queryByRole('article', { name: 'Vorschlag' })).toBeNull()
    await send('Und?')
    expect(toolResults(driven.sent[1].call)).toEqual([expect.objectContaining({ tool_use_id: 'toolu_cut', is_error: true })])
  })

  it('a hand edit survives a later assistant turn (PRD F4): the old proposal goes stale, the snapshot shows the edit', async () => {
    const start = makeProject({ steps: { 1: { block: { targetGroups: [makeItem(1, 'targetGroups', { name: 'Eltern', reach: 'indirect' }, { id: 'tg1' })] } } } })
    const { user, driven, store, send } = await openSession(readyStore({ [keys.project]: start }))
    await send('Eltern sind direkt dabei.')
    const update = { summary: 'Eltern direkt.', question: 'Passt das so?', changes: [{ op: 'update', collection: 'targetGroups', id: 'tg1', fields: { name: 'Eltern', description: '', reach: 'direct', isFocus: false, sizeEstimate: '', why: '' } }] }
    await driven.answer([proposeUse('toolu_1', update)])
    await screen.findByRole('article', { name: 'Vorschlag' })

    const name = within(screen.getByRole('region', { name: 'Baustein' })).getByRole('textbox', { name: 'Name der Zielgruppe' })
    await user.clear(name)
    await user.type(name, 'Mütter und Väter{Enter}')
    await send('Ich hab den Namen geändert.')
    await driven.answer([{ type: 'text', text: 'Gesehen.' }])
    await screen.findByText('Gesehen.')

    expect(screen.getByText('du hast das inzwischen geändert')).toBeTruthy()
    const project = (await store.get(keys.project)) as Project
    expect(project.steps[1].block.targetGroups[0]).toMatchObject({ name: 'Mütter und Väter', reach: 'indirect', editedByUser: true })
    const turn = JSON.stringify(driven.sent[1].call.messages.at(-1))
    expect(turn).toContain('Mütter und Väter')
    expect(turn).toContain('veraltet')
  })
})

describe('proposal card: more paths (review gaps)', () => {
  it('two proposals: the line jumps to the oldest with open changes, then to the next', async () => {
    const first = mixed()
    const second = { ...makeProposal([{ op: 'update', collection: 'challenge', targetId: 'challenge', baseRev: 1, fields: { why: 'Darum.' } }], { id: 'p2' }), toolUseId: 'toolu_p2' }
    const project = withProposal(first)
    project.steps[1].proposals.push(second)
    project.steps[1].segments[0].messages.push({ id: 'm3', at, role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_p2', name: 'propose_changes', input: {} }] })
    const user = userEvent.setup()
    render(<Harness initial={project} />)
    const cardOf = (id: string) => document.querySelector<HTMLElement>(`[data-proposal-id="${id}"]`)!
    await user.click(blockPanel().getByRole('button', { name: '4 offene Änderungen im Chat' }))
    expect(document.activeElement).toBe(cardOf('p1'))
    await user.click(within(cardOf('p1')).getByRole('button', { name: 'Alle übernehmen' }))
    await user.click(blockPanel().getByRole('button', { name: '1 offene Änderung im Chat' }))
    expect(document.activeElement).toBe(cardOf('p2'))
  })

  it('Rückgängig of an applied ÄNDERN restores the old value; of an applied NEU removes the item', async () => {
    const { user, card } = open(withProposal(mixed()))
    await user.click(card().getByRole('button', { name: 'Übernehmen: Ändern – Zielgruppe „Eltern“' }))
    expect(latest.steps[1].block.targetGroups[0].reach).toBe('direct')
    await user.click(card().getByRole('button', { name: 'Rückgängig: Ändern – Zielgruppe „Eltern“' }))
    expect(latest.steps[1].block.targetGroups[0].reach).toBe('indirect')
    await user.click(card().getByRole('button', { name: 'Übernehmen: Neu – Zielgruppe „Jugendliche 12–17“' }))
    await user.click(card().getByRole('button', { name: 'Rückgängig: Neu – Zielgruppe „Jugendliche 12–17“' }))
    expect(latest.steps[1].block.targetGroups.map((g) => g.id)).toEqual(['tg1'])
    expect(document.querySelector('[data-outlined]')).toBeNull()
  })

  it('after a hand edit of an applied item, its row keeps "übernommen" but loses Rückgängig', async () => {
    const p = makeProposal([{ op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { description: 'holen die Räder ab' } }])
    const { user, card } = open(withProposal(p))
    await user.click(card().getByRole('button', { name: /^Übernehmen:/ }))
    const description = blockPanel().getByRole('textbox', { name: 'Beschreibung der Zielgruppe' })
    await user.type(description, ' und bringen Kuchen{Enter}')
    expect(card().getByText('übernommen')).toBeTruthy()
    expect(card().queryByRole('button', { name: /^Rückgängig:/ })).toBeNull()
  })

  it('focus: after Ablehnen on the row’s Rückgängig, after "Alle übernehmen" on the first row’s; both announced', async () => {
    const { user, card } = open(withProposal(mixed()))
    await user.click(card().getByRole('button', { name: 'Ablehnen: Entfernen – Beteiligte „Schule nebenan“' }))
    expect(document.activeElement).toBe(card().getByRole('button', { name: 'Rückgängig: Entfernen – Beteiligte „Schule nebenan“' }))
    expect(card().getByRole('status').textContent).toBe('Abgelehnt: Beteiligte „Schule nebenan“')
    await user.click(card().getByRole('button', { name: 'Alle übernehmen' }))
    expect(document.activeElement).toBe(card().getByRole('button', { name: 'Rückgängig: Neu – Zielgruppe „Jugendliche 12–17“' }))
    expect(card().getByRole('status').textContent).toBe('2 Änderungen übernommen')
  })

  it('a dependent row: Übernehmen is aria-disabled with its reason and does nothing', async () => {
    const p = makeProposal([
      { op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: groupFields },
      { op: 'update', collection: 'targetGroups', targetId: 'new:1', fields: { sizeEstimate: 'etwa 15' } },
    ])
    const { user, card } = open(withProposal(p))
    const waiting = card().getByRole('button', { name: /^Übernehmen: Ändern/ })
    expect(waiting.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(waiting.getAttribute('aria-describedby')!)!.textContent).toBe('zuerst ‚Neu: Jugendliche 12–17‘ übernehmen')
    const before = latest
    await user.click(waiting)
    expect(latest).toBe(before)
  })

  it('a removed target shows "gibt es nicht mehr"', async () => {
    const p = makeProposal([{ op: 'update', collection: 'stakeholders', targetId: 'sh1', baseRev: 1, fields: { expectations: ['Zahlen'] } }])
    const { card } = open(withProposal(p))
    await userEvent.setup().click(blockPanel().getByRole('button', { name: 'Beteiligte „Schule nebenan“ entfernen' }))
    expect(card().getByText('gibt es nicht mehr')).toBeTruthy()
  })

  it('an applied ENTFERNEN leaves the undo line in the block; its Rückgängig undoes the change in the card too', async () => {
    const { user, card } = open(withProposal(mixed()))
    const apply = card().getByRole('button', { name: 'Übernehmen: Entfernen – Beteiligte „Schule nebenan“' })
    await user.click(apply)
    const line = blockPanel().getByText('„Schule nebenan“ entfernt.')
    // Focus stays in the card.
    expect(document.activeElement).toBe(card().getByRole('button', { name: 'Rückgängig: Entfernen – Beteiligte „Schule nebenan“' }))
    await user.click(within(line.closest('p')!).getByRole('button', { name: 'Rückgängig' }))
    expect(latest.steps[1].block.stakeholders.map((s) => s.id)).toEqual(['sh1'])
    expect(card().getByRole('button', { name: 'Übernehmen: Entfernen – Beteiligte „Schule nebenan“' })).toBeTruthy()
  })

  it('undo from the card removes the block’s undo line', async () => {
    const { user, card } = open(withProposal(mixed()))
    await user.click(card().getByRole('button', { name: 'Übernehmen: Entfernen – Beteiligte „Schule nebenan“' }))
    await user.click(card().getByRole('button', { name: 'Rückgängig: Entfernen – Beteiligte „Schule nebenan“' }))
    expect(blockPanel().queryByText('„Schule nebenan“ entfernt.')).toBeNull()
  })

  it('Übernehmen while a block field holds an unsaved draft: the draft wins and the row goes VERALTET', async () => {
    const p = makeProposal([{ op: 'update', collection: 'targetGroups', targetId: 'tg1', baseRev: 1, fields: { name: 'Eltern (alle)' } }])
    const { user, card } = open(withProposal(p))
    const name = blockPanel().getByRole('textbox', { name: 'Name der Zielgruppe' })
    await user.clear(name)
    await user.type(name, 'Mütter und Väter')
    await user.click(card().getByRole('button', { name: /^Übernehmen:/ }))
    expect(latest.steps[1].block.targetGroups[0].name).toBe('Mütter und Väter')
    expect(card().getByText('du hast das inzwischen geändert')).toBeTruthy()
  })

  it('a focus hand-off that found nothing to do does not steal focus on a later render', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // The parent ignores the action (the reducer refused it), so the card's state stays as it was.
    const p = makeProposal([{ op: 'remove', collection: 'stakeholders', targetId: 'sh1', baseRev: 1 }])
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let setProject: (p: Project) => void = () => {}
    function Frozen({ initial }: { initial: Project }) {
      const [project, set] = useState(initial)
      setProject = set
      return <App project={project} initialView={{ kind: 'step', step: 1 }} onBlockAction={() => {}} />
    }
    render(<Frozen initial={withProposal(p)} />)
    // The second click repeats the same announcement, so nothing re-renders to use up the hand-off.
    await user.click(screen.getByRole('button', { name: /^Ablehnen:/ }))
    await user.click(screen.getByRole('button', { name: /^Ablehnen:/ }))
    await act(async () => vi.advanceTimersByTime(10))
    const input = screen.getByRole('textbox', { name: 'Deine Nachricht' })
    act(() => input.focus())
    act(() => setProject({ ...latestOf(p) }))
    expect(document.activeElement).toBe(input)
    vi.useRealTimers()
  })
})

const latestOf = (p: Proposal) => withProposal(p)

// ---- The one question under every card (step 18b, design §6.2) ----------------------------

describe('the question under the card', () => {
  const message = () => screen.getByRole('article', { name: 'Vorschlag' }).closest('li')!
  const ask = (question: string) => ({ ...addGroup, question })

  it('shows below the card as the message’s last line, also when the message has no text', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([proposeUse('toolu_1', ask('Wer kommt außer ihnen noch?'))])
    await screen.findByRole('article', { name: 'Vorschlag' })
    const last = message().lastElementChild!
    expect(last.tagName).toBe('P')
    expect(last.className).toBe('msg__question')
    expect(last.textContent).toBe('Wer kommt außer ihnen noch?')
    // After the card, not inside it: the card holds what can be applied.
    expect(screen.getByRole('article', { name: 'Vorschlag' }).contains(last)).toBe(false)
    expect(screen.getByRole('article', { name: 'Vorschlag' }).compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows once when Claude’s text ends with the same question; a different question in the text stays', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([{ type: 'text', text: 'Ich nehme die Jugendlichen auf. Wer kommt außer ihnen noch?' }, proposeUse('toolu_1', ask('Wer kommt außer ihnen noch?'))])
    await screen.findByRole('article', { name: 'Vorschlag' })
    expect(within(message()).getAllByText(/Wer kommt außer ihnen noch\?/)).toHaveLength(1)
    expect(within(message()).getByText('Ich nehme die Jugendlichen auf.')).toBeTruthy()
    expect(message().lastElementChild!.textContent).toBe('Wer kommt außer ihnen noch?')

    await send('Die Eltern.')
    await driven.answer([{ type: 'text', text: 'Gut. Sind die Eltern direkt dabei?' }, proposeUse('toolu_2', { ...ask('Wer fehlt noch?'), changes: [{ ...addGroup.changes[0], fields: { ...addGroup.changes[0].fields, name: 'Eltern' } }] })])
    await screen.findByText('Wer fehlt noch?')
    expect(screen.getByText('Gut. Sind die Eltern direkt dabei?')).toBeTruthy()
  })

  it('the announcement of the finished message ends with the question, the copy in the text left out', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([{ type: 'text', text: 'Ich nehme sie auf.\n\nWer kommt außer ihnen noch?' }, proposeUse('toolu_1', ask('Wer kommt außer ihnen noch?'))])
    await screen.findByRole('article', { name: 'Vorschlag' })
    expect(screen.getByTestId('chat-live').textContent).toBe('Wirkungshelferin: Ich nehme sie auf.\n\nWer kommt außer ihnen noch?')
  })

  it('two cards in one message ask one question: the last card’s', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche und Eltern.')
    const eltern = { ...ask('Und die Eltern?'), changes: [{ ...addGroup.changes[0], fields: { ...addGroup.changes[0].fields, name: 'Eltern' } }] }
    await driven.answer([proposeUse('toolu_1', ask('Zuerst die Jugendlichen?')), proposeUse('toolu_2', eltern)])
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Vorschlag' })).toHaveLength(2))
    expect(screen.queryByText('Zuerst die Jugendlichen?')).toBeNull()
    const [one, two] = screen.getAllByRole('article', { name: 'Vorschlag' })
    expect(one.closest('li')).toBe(two.closest('li'))
    expect(two.closest('li')!.lastElementChild!.textContent).toBe('Und die Eltern?')
  })

  it('an empty question shows no line; a reload keeps the question', async () => {
    const first = await openSession()
    await first.send('Für Jugendliche.')
    await first.driven.answer([proposeUse('toolu_1', ask('Wer kommt außer ihnen noch?'))])
    await screen.findByText('Wer kommt außer ihnen noch?')
    await waitFor(async () => expect(((await first.store.get(keys.project)) as Project).steps[1].proposals[0]?.question).toBe('Wer kommt außer ihnen noch?'))
    document.body.innerHTML = ''

    const again = await openSession(reloaded(first.store))
    expect(await screen.findByText('Wer kommt außer ihnen noch?')).toBeTruthy()
    await again.send('Weiter.')
    await again.driven.answer([proposeUse('toolu_2', { ...ask(''), changes: [{ ...addGroup.changes[0], fields: { ...addGroup.changes[0].fields, name: 'Eltern' } }] })])
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Vorschlag' })).toHaveLength(2))
    const second = screen.getAllByRole('article', { name: 'Vorschlag' })[1]
    expect(second.closest('li')!.querySelector('.msg__question')).toBeNull()
  })

  it('the question renders inline Markdown only: a step link works, a list doesn’t become one', async () => {
    const { driven, send } = await openSession()
    await send('Für Jugendliche.')
    await driven.answer([proposeUse('toolu_1', ask('Ist das **wirklich** alles?\n\n- eins\n- zwei'))])
    await screen.findByRole('article', { name: 'Vorschlag' })
    const line = message().querySelector('.msg__question')!
    expect(line.querySelector('strong')!.textContent).toBe('wirklich')
    expect(line.querySelector('ul, li, p')).toBeNull()
  })
})
