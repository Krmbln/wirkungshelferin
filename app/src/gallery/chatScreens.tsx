import type { ReactNode } from 'react'
import { makeProject, makeProposal } from '../domain/fixtures'
import type { ChatSegment, Project, StoredMessage } from '../domain/schemas/project'
import type { Drafts } from '../storage/drafts'
import { App } from '../ui/App'
import type { ChatRun } from '../ui/chat/stream'

// Chat states for the gallery (step 9). Made-up content (the "Schraubzeit" bike workshop of
// demo.ts), unlike the guide example and Lukas's case.

const at = '2026-11-04T11:40:00.000Z'
let n = 0
const user = (text: string, when = at): StoredMessage => ({
  id: `g${++n}`,
  at: when,
  role: 'user',
  content: [{ type: 'text', text }, { type: 'text', text: '[Baustein unverändert]' }],
})
const claude = (text: string, extra: Partial<StoredMessage> & { toolUse?: string } = {}): StoredMessage => {
  const { toolUse, ...rest } = extra
  return {
    id: `g${++n}`,
    at,
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '…', signature: 'gallery' },
      ...(text ? [{ type: 'text', text }] : []),
      ...(toolUse ? [{ type: 'tool_use', id: toolUse, name: 'propose_changes', input: {} }] : []),
    ],
    ...rest,
  }
}

const conversation: StoredMessage[] = [
  user('Hallo! Wir sind die Schraubzeit, eine offene Fahrradwerkstatt für Jugendliche im Stadtteil.'),
  claude(
    'Schön, dass du da bist. In diesem Schritt klären wir drei Dinge:\n\n1. **Welche Herausforderung** ihr angeht,\n2. **für wen** ihr da seid,\n3. und **wer mitredet** – zum Beispiel Schule oder Eltern.\n\nFangen wir mit der Herausforderung an: Was fehlt den Jugendlichen bei euch im Stadtteil, bevor sie zu euch kommen?',
  ),
  user('Viele haben kein eigenes Fahrrad oder eins, das kaputt ist. Und es gibt kaum Orte, wo sie nachmittags hinkönnen.'),
  claude(
    'Das sind zwei verschiedene Dinge: fehlende **Mobilität** und fehlende **Orte**. Ich schlage dir vor, beides als Herausforderung festzuhalten und die Jugendlichen als erste Zielgruppe aufzunehmen.\n\nWer kommt am häufigsten – eher Jüngere oder Ältere?',
    { toolUse: 'toolu_g1' },
  ),
]

const proposals = [
  makeProposal(
    [{ op: 'add', collection: 'targetGroups', tempId: 'new:1', fields: { name: 'Jugendliche 12–17', description: 'aus dem Stadtteil', reach: 'direct', isFocus: true } }],
    { id: 'p1', summary: 'Jugendliche 12–17 als erste Zielgruppe aufnehmen, weil sie die Werkstatt am meisten nutzen.' },
  ),
].map((p) => ({ ...p, toolUseId: 'toolu_g1' }))

function project(messages: StoredMessage[], segments?: ChatSegment[]): Project {
  // A proposal only exists with the message that made it: an empty chat has none (the app can't
  // show "1 offene Änderung" beside an empty chat).
  const talk = segments ?? (messages.length ? [{ id: 'seg1', startedAt: at, messages }] : [])
  const p = makeProject({ steps: { 0: { status: 'confirmed' }, 1: { status: 'in_progress', proposals: talk.length ? proposals : [] } } })
  p.steps[1].segments = talk
  return p
}

const galleryNow = new Date('2026-11-04T12:00:00')
const noop = () => {}

function ChatScreen({ messages = conversation, segments, run, drafts }: { messages?: StoredMessage[]; segments?: ChatSegment[]; run?: ChatRun; drafts?: Drafts }) {
  return (
    <App
      now={galleryNow}
      project={project(messages, segments)}
      initialView={{ kind: 'step', step: 1 }}
      chat={{ runs: run ? { 1: run } : {}, send: noop, act: noop, stop: noop, retry: noop }}
      drafts={drafts}
    />
  )
}

const lastQuestion = user('Meistens Jüngere, so 12 bis 14.')
const partial = 'Gut, dann ist die Gruppe enger, als ich dachte. Bei 12- bis 14-Jährigen spielen die **Eltern** oft'

// Step 10: an earlier session on 26.10., a new segment carrying a summary.
const earlier = '2026-10-26T15:10:00.000Z'
const oldTalk = conversation.map((m) => ({ ...m, at: earlier }))
const summary =
  '- Die Schraubzeit ist eine offene Fahrradwerkstatt für Jugendliche im Stadtteil.\n- Herausforderung: fehlende Mobilität und fehlende Orte am Nachmittag.\n- Jugendliche 12–14 als erste Zielgruppe vorgeschlagen, noch nicht übernommen.\n- Zuletzt gefragt: Wer kommt am häufigsten?'
const newTalk = [
  lastQuestion,
  claude('Danke. Dann nehmen wir die 12- bis 14-Jährigen als Fokusgruppe. Wer redet bei euch noch mit – Eltern, Schule, Jugendamt?'),
]
const segmented = (withSummary: boolean): ChatSegment[] => [
  { id: 'seg1', startedAt: earlier, model: 'claude-opus-5-5', messages: oldTalk },
  { id: 'seg2', startedAt: at, model: 'claude-sonnet-5-5', ...(withSummary && { summaryOfPrevious: summary }), messages: newTalk },
]
const longTalk = [
  ...conversation,
  lastQuestion,
  claude(
    'Gut. Dann schauen wir auf die **Beteiligten**. Das sind alle, die mit eurem Angebot zu tun haben oder es beeinflussen:\n\n- die Eltern, die ihre Kinder schicken oder auch nicht,\n- die Schule nebenan,\n- das Jugendamt als Geldgeber,\n- und eure Ehrenamtlichen.\n\nWer davon ist für euch am wichtigsten?',
  ),
  user('Die Ehrenamtlichen, ohne die läuft nichts. Und das Jugendamt, weil es uns bezahlt.'),
]

export const chatScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  'chat-empty': { caption: 'Chat: noch leer', render: () => <ChatScreen messages={[]} /> },
  chat: { caption: 'Chat: Gespräch mit Markdown und Vorschlag', render: () => <ChatScreen /> },
  'chat-thinking': {
    caption: 'Chat: „denkt nach …“',
    render: () => <ChatScreen messages={[...conversation, lastQuestion]} run={{ kind: 'running', blocks: [{ type: 'other' }] }} />,
  },
  'chat-streaming': {
    caption: 'Chat: Text kommt an (Stopp)',
    render: () => (
      <ChatScreen messages={[...conversation, lastQuestion]} run={{ kind: 'running', blocks: [{ type: 'other' }, { type: 'text', text: partial }] }} />
    ),
  },
  'chat-aborted': {
    caption: 'Chat: abgebrochen',
    render: () => <ChatScreen messages={[...conversation, lastQuestion, claude(partial, { aborted: true })]} />,
  },
  'chat-key-error': {
    caption: 'Chat: Schlüssel ungültig',
    render: () => <ChatScreen messages={[...conversation, lastQuestion]} run={{ kind: 'failed', problem: 'key', partial: '' }} />,
  },
  'chat-failed': {
    caption: 'Chat: Verbindung abgerissen, Text bis dahin',
    render: () => <ChatScreen messages={[...conversation, lastQuestion]} run={{ kind: 'failed', problem: 'unreachable', partial }} />,
  },
  'chat-no-answer': {
    caption: 'Chat: nach dem Neuladen ohne Antwort',
    render: () => <ChatScreen messages={[...conversation, lastQuestion]} />,
  },
  'chat-intro': { caption: 'Chat: Intro offen (erster Besuch)', render: () => <ChatScreen messages={[]} /> },
  'chat-session': {
    caption: 'Chat: „Letzte Sitzung“ vor den neuen Nachrichten',
    render: () => <ChatScreen messages={[...oldTalk, ...newTalk]} />,
  },
  'chat-back': {
    caption: 'Chat: zurück nach einer Pause, noch nichts Neues',
    render: () => <ChatScreen messages={oldTalk} />,
  },
  'chat-summarising': {
    caption: 'Chat: fasst vor einem neuen Abschnitt zusammen',
    render: () => <ChatScreen messages={conversation} run={{ kind: 'summarising', text: 'Meistens Jüngere, so 12 bis 14.' }} />,
  },
  'chat-segment': { caption: 'Chat: neuer Abschnitt mit Zusammenfassung', render: () => <ChatScreen segments={segmented(true)} /> },
  'chat-segment-none': { caption: 'Chat: neuer Abschnitt ohne Zusammenfassung', render: () => <ChatScreen segments={segmented(false)} /> },
  'chat-long-streaming': {
    caption: 'Chat: langes Gespräch, Antwort kommt an',
    render: () => <ChatScreen messages={longTalk} run={{ kind: 'running', blocks: [{ type: 'other' }, { type: 'text', text: partial }] }} />,
  },
  'chat-draft': {
    caption: 'Chat: Entwurf mit mehreren Zeilen',
    render: () => <ChatScreen drafts={{ 1: 'Eher Jüngere.\nDie Älteren kommen eher am Wochenende,\nwenn wir länger offen haben.' }} />,
  },
}
