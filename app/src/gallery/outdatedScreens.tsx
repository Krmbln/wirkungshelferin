import { useState, type ReactNode } from 'react'
import { prepareAct } from '../ai/chat'
import { markOutdated } from '../domain/outdated'
import { reducer } from '../domain/reducer'
import type { Project } from '../domain/schemas/project'
import { stepIds, type StepId } from '../domain/types'
import { App } from '../ui/App'
import type { ChatControls } from '../ui/chat/useChatRunner'
import { step6Project } from './step6Screens'

// Change handling for the gallery (step 21): outdated steps with their banner (one change,
// several, the frame alone, with another step, running, waiting, checked), the outdated gate
// and the cascade line under a re-confirmed step. Made-up content (the "Schraubzeit" workshop).

const galleryNow = new Date('2026-11-10T15:00:00')
const first = '2026-11-04T11:40:00.000Z'
const later = '2026-11-10T09:30:00.000Z'
const turnAt = '2026-11-10T14:50:00.000Z'

/** Steps 0–6 all confirmed (step 6 as the gallery's step 6 shows it), each with a current check. */
function allConfirmed(): Project {
  const p = step6Project()
  // The gallery's steps 2 and 4 keep an item without a Why (their ⛔ samples); here they are complete.
  for (const a of p.steps[4].block.activities) a.why ||= 'Ohne Elternbrief kommen die Jüngeren nicht.'
  for (const c of p.steps[2].block.causes) c.why ||= 'Erzählen die Eltern.'
  for (const s of stepIds) {
    const state = p.steps[s]
    state.status = 'confirmed'
    state.confirmed = { at: first, block: structuredClone(state.block) as never, basis: {} }
    state.qualityCheck = { at: first, source: 'app', block: structuredClone(state.block) as never, results: [{ criterion: '1', result: 'ok', note: 'Passt.' }] }
  }
  return p
}

/** Re-confirms an earlier step after `change` edited its block (what the gate does, without the check). */
function reconfirmed(p: Project, step: StepId, change: (block: Record<string, unknown>) => void): Project {
  const next = structuredClone(p)
  const state = next.steps[step]
  const previous = state.confirmed!
  change(state.block as unknown as Record<string, unknown>)
  state.confirmed = { at: later, block: structuredClone(state.block) as never, basis: {} }
  state.qualityCheck = { at: later, source: 'app', block: structuredClone(state.block) as never, results: [] }
  markOutdated(next, step, { at: previous.at, block: previous.block as Record<string, unknown> })
  return next
}

const causeChanged = (p: Project) =>
  reconfirmed(p, 2, (b) => {
    const causes = b.causes as { text: string }[]
    causes[0] = { ...causes[0], text: `${causes[0].text.replace(/\.$/, '')}, und die Werkstatt ist nur zweimal die Woche offen.` }
  })
const profileChanged = (p: Project) => reconfirmed(p, 0, (b) => void ((b.profile as { location: string }).location = 'Nordstadt, ab Mai auch Südstadt'))
const frameChanged = (p: Project) => reconfirmed(p, 0, (b) => void ((b.frame as { audience: string }).audience = 'Stiftung und Vorstand'))

/** Step 4 with the review turn stored (and answered). */
function asked(p: Project, step: StepId, answer?: string): Project {
  const next = prepareAct(p, step, { kind: 'review' }, { at: turnAt })!.project
  if (answer) next.steps[step].segments.at(-1)!.messages.push({ id: 'answer', at: turnAt, role: 'assistant', content: [{ type: 'text', text: answer }] })
  return next
}

const ANSWER =
  'In Schritt 2 steht jetzt zusätzlich: Die Werkstatt ist nur zweimal die Woche offen.\n\n' +
  'Für deine Wirkungslogik heißt das: Die Verbindung „Jugendliche kommen regelmäßig“ → „sie flicken selbst“ hängt stärker an den Öffnungszeiten, als dein Baustein sagt. Die Kette selbst passt noch.\n\n' +
  'Willst du bei dieser Verbindung die Öffnungszeiten als Annahme ergänzen, oder reicht dir das so?'

function OutdatedScreen({ start, step, runs }: { start: () => Project; step: StepId; runs?: ChatControls['runs'] }) {
  const [project, setProject] = useState(start)
  const chat: ChatControls | undefined = runs ? { runs, send: () => {}, act: () => {}, stop: () => {}, retry: () => {} } : undefined
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step }} chat={chat} onBlockAction={(a) => setProject((p) => reducer(p, a))} />
}

const running: ChatControls['runs'] = { 4: { kind: 'running', blocks: [] } }

export const outdatedScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  outdated: { caption: 'Veraltet: Schritt 4 nach einer Änderung in Schritt 2 (Banner, Check mit Bestätigen)', render: () => <OutdatedScreen start={() => causeChanged(allConfirmed())} step={4} /> },
  'outdated-several': { caption: 'Veraltet: Schritt 5 nach Schritt 0 (Profil) und Schritt 2', render: () => <OutdatedScreen start={() => causeChanged(profileChanged(allConfirmed()))} step={5} /> },
  'outdated-frame': { caption: 'Veraltet: Schritt 6 nach dem Messrahmen in Schritt 0', render: () => <OutdatedScreen start={() => frameChanged(allConfirmed())} step={6} /> },
  'outdated-frame-plus': { caption: 'Veraltet: Schritt 5 nach Messrahmen und Schritt 2', render: () => <OutdatedScreen start={() => causeChanged(frameChanged(allConfirmed()))} step={5} /> },
  'outdated-running': { caption: 'Veraltet: Änderung wird geprüft', render: () => <OutdatedScreen start={() => asked(causeChanged(allConfirmed()), 4)} step={4} runs={running} /> },
  'outdated-busy': {
    caption: 'Veraltet: eine andere Antwort läuft (Button mit Grund)',
    render: () => <OutdatedScreen start={() => prepareTurnOf(causeChanged(allConfirmed()))} step={4} runs={running} />,
  },
  'outdated-reviewed': { caption: 'Veraltet: geprüft, Antwort im Chat', render: () => <OutdatedScreen start={() => asked(causeChanged(allConfirmed()), 4, ANSWER)} step={4} /> },
  'outdated-cascade': { caption: 'Schritt 2 neu bestätigt: Schritt 3–6 vielleicht veraltet', render: () => <OutdatedScreen start={() => causeChanged(allConfirmed())} step={2} /> },
  'outdated-cascade-one': {
    caption: 'Schritt 2 neu bestätigt: nur noch Schritt 6 veraltet',
    render: () => (
      <OutdatedScreen
        start={() => {
          const p = causeChanged(allConfirmed())
          for (const s of [3, 4, 5] as const) {
            p.steps[s].status = 'confirmed'
            delete p.steps[s].outdatedBy
          }
          return p
        }}
        step={2}
      />
    ),
  },
}

/** Lukas asked something in the chat of the outdated step 4; the answer is running. */
function prepareTurnOf(p: Project): Project {
  const next = structuredClone(p)
  next.steps[4].segments = [{ id: 's1', startedAt: turnAt, messages: [{ id: 'q', at: turnAt, role: 'user', content: [{ type: 'text', text: 'Was heißt „vielleicht veraltet“ hier?' }, { type: 'text', text: '[Baustein unverändert]' }] }] }]
  return next
}
