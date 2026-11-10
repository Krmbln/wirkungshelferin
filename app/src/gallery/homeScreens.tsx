import type { ReactNode } from 'react'
import { markActive, withResume } from '../domain/resume'
import type { Project, StoredMessage } from '../domain/schemas/project'
import { stepIds, type StepId, type StepStatus } from '../domain/types'
import { App } from '../ui/App'
import { step6Project } from './step6Screens'

// Home complete for the gallery (step 22): the card's states A–F with real-length texts, the
// longest step title, a cut summary, and the card and chip naming different steps. Made-up
// content (the "Schraubzeit" workshop).

const galleryNow = new Date('2026-11-10T15:00:00')
const earlier = '2026-11-05T11:40:00.000Z'
const turn = '2026-11-10T14:20:00.000Z'
const left = '2026-11-10T14:30:00.000Z'

function withStatuses(statuses: Partial<Record<StepId, StepStatus>>): Project {
  const p = step6Project()
  for (const s of stepIds) {
    const status = statuses[s] ?? 'not_started'
    p.steps[s].status = status
    p.steps[s].segments = []
    p.steps[s].confirmed = status === 'not_started' ? undefined : { at: s === 2 ? '2026-11-10T09:15:00.000Z' : s === 1 ? '2026-11-09T16:00:00.000Z' : earlier, block: structuredClone(p.steps[s].block) as never, basis: {} }
  }
  return p
}

let n = 0
const message = (role: 'user' | 'assistant', text: string, extra: Partial<StoredMessage> = {}): StoredMessage => ({
  id: `g${++n}`,
  at: turn,
  role,
  content: role === 'user' ? [{ type: 'text', text }, { type: 'text', text: '[Baustein unverändert]' }] : [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
  ...extra,
})

function chat(p: Project, step: StepId, messages: StoredMessage[]): Project {
  const next = structuredClone(p)
  next.steps[step].segments = [{ id: `gs${step}`, startedAt: turn, model: 'claude-opus-5-5', messages }]
  return next
}

const step3Chat = (p: Project) =>
  chat(p, 3, [
    message('user', 'Die Älteren sollen den Jüngeren zeigen, wie man einen Schlauch flickt.'),
    message(
      'assistant',
      'Das ist ein starkes Ziel auf Stufe 5: Die Älteren tun etwas anders. Damit wir es später prüfen können, fehlt mir noch eine Sache. Woran würdet ihr im Sommer merken, dass die Älteren das wirklich von sich aus tun und nicht nur, wenn ihr danebensteht?',
    ),
  ])

const working = () => withStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'in_progress' })

const summary = 'Für die Jugendlichen aus der Nordstadt stehen zwei Ziele auf Stufe 4 und eins auf Stufe 5. Offen ist noch, woran ihr merkt, dass die Älteren den Jüngeren von sich aus helfen.'
const nextAction = 'Beantworte im Chat, woran ihr im Sommer merkt, dass die Älteren von sich aus helfen.'
const longSummary =
  'Für „Jugendliche aus der Nordstadt, die ihr Rad selbst reparieren wollen“ und für „Eltern, die ihre Kinder allein in die Werkstatt schicken“ stehen jetzt die Herausforderung, beide Fokusgruppen und vier Beteiligte, darunter der Hausmeister der Schule und das Quartiersmanagement, das die Räume stellt und die Öffnungszeiten mitbestimmt.'
const longAction = 'Prüf im Baustein, ob der Hausmeister wirklich als Beteiligter gilt oder eher zu den Unterstützern gehört, und bestätige dann den Schritt.'

function screen(project: Project, extra: { writing?: StepId } = {}): ReactNode {
  return <App now={galleryNow} project={project} resume={{ writing: extra.writing, write: () => {} }} />
}

export const homeScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  'home-resume': {
    caption: 'Übersicht B: Wo du aufgehört hast, mit Zusammenfassung',
    render: () => screen(withResume(markActive(step3Chat(working()), 3, left), 3, { summary, nextAction, at: left })),
  },
  'home-resume-long': {
    caption: 'Übersicht B: längster Titel, Zusammenfassung abgeschnitten',
    render: () => {
      const p = withStatuses({ 0: 'confirmed', 1: 'in_progress' })
      const active = markActive(chat(p, 1, [message('assistant', 'Passt das so?')]), 1, left)
      return screen(withResume(active, 1, { summary: `${longSummary} ${longSummary}`, nextAction: longAction, at: left }))
    },
  },
  'home-fallback': {
    caption: 'Übersicht C: noch keine Zusammenfassung, letzte Frage',
    render: () => screen(markActive(step3Chat(working()), 3, left)),
  },
  'home-writing': {
    caption: 'Übersicht D: Zusammenfassung wird geschrieben',
    render: () => screen(markActive(step3Chat(working()), 3, left), { writing: 3 }),
  },
  'home-unanswered': {
    caption: 'Übersicht C: letzte Nachricht ohne Antwort',
    render: () => screen(markActive(chat(working(), 3, [message('assistant', 'Woran merkt ihr das?'), message('user', 'Daran, dass sie fragen.')]), 3, left)),
  },
  'home-confirmed': {
    caption: 'Übersicht E: Schritt 2 heute bestätigt, Schritt 3 als Nächstes',
    render: () => screen(markActive(withStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed' }), 2, left)),
  },
  'home-confirmed-outdated': {
    caption: 'Übersicht E: der empfohlene Schritt ist vielleicht veraltet',
    render: () => screen(markActive(withStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'maybe_outdated', 4: 'maybe_outdated' }), 2, left)),
  },
  'home-ahead': {
    caption: 'Übersicht: vorgesprungen – Karte Schritt 3, Chip Schritt 1',
    render: () => {
      const p = step3Chat(withStatuses({ 0: 'confirmed', 1: 'in_progress', 3: 'in_progress' }))
      return screen(withResume(markActive(p, 3, left), 3, { summary, nextAction, at: left }))
    },
  },
  'home-done': {
    caption: 'Übersicht F: alle Schritte bestätigt',
    render: () => screen(markActive(withStatuses({ 0: 'confirmed', 1: 'confirmed', 2: 'confirmed', 3: 'confirmed', 4: 'confirmed', 5: 'confirmed', 6: 'confirmed' }), 6, left)),
  },
}
