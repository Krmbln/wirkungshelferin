import { useState, type ReactNode } from 'react'
import { makeItem, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, Proposal, StoredMessage } from '../domain/schemas/project'
import { App } from '../ui/App'
import { filled } from './blockScreens'

// Proposal cards for the gallery (step 12). Made-up content (the "Schraubzeit" bike workshop
// of demo.ts), unlike the guide example and Lukas's case. Stateful like the Session, so the
// review can click Übernehmen, Ablehnen, Rückgängig, "Alle übernehmen" and the jump line.

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:40:00.000Z'

const groupFields = (name: string, description: string, why: string) => ({ name, description, reach: 'direct', isFocus: true, why })

/** Every row state in one card: open NEU / ÄNDERN / ENTFERNEN, dependent, applied, rejected, stale. */
function everyState(): Proposal {
  return makeProposal(
    [
      {
        op: 'add',
        collection: 'targetGroups',
        tempId: 'new:1',
        fields: groupFields(
          'Stammgäste 12–14',
          'Kommen dienstags und donnerstags, viele ohne eigenes Rad.',
          'Bei ihnen ist Veränderung zu erwarten, weil sie regelmäßig kommen.',
        ),
      },
      { op: 'update', collection: 'targetGroups', targetId: 'new:1', fields: { sizeEstimate: 'etwa 10 pro Nachmittag' } },
      { op: 'update', collection: 'targetGroups', targetId: 'tg2', baseRev: 2, fields: { reach: 'direct' } },
      { op: 'remove', collection: 'stakeholders', targetId: 'sh3', baseRev: 1 },
      { op: 'add', collection: 'stakeholders', tempId: 'new:2', fields: { role: 'Jugendamt – Kooperationspartner', expectations: ['Kurzer Bericht pro Jahr'] } },
      { op: 'add', collection: 'stakeholders', tempId: 'new:3', fields: { role: 'Hausverwaltung der Siedlung', expectations: [] } },
      { op: 'update', collection: 'stakeholders', targetId: 'sh2', baseRev: 2, fields: { expectations: ['Feste Zeiten'] } },
    ],
    { id: 'p1', summary: 'Die Stammgäste als eigene Fokusgruppe, Eltern direkt erreicht, Beteiligte aufgeräumt.' },
  )
}

/** A first draft like the recorded opening answer: one update and six adds. */
function opening(): Proposal {
  return makeProposal(
    [
      {
        op: 'update',
        collection: 'challenge',
        targetId: 'challenge',
        baseRev: 1,
        fields: {
          text: 'Viele Jugendliche aus der Weidengrund-Siedlung kommen selten aus ihrer Siedlung heraus, weil sie nicht selbstständig mobil sind.',
          why: 'Abgeleitet aus Schritt 0: Das Projekt will, dass Jugendliche mobiler werden. Beobachtungen, die das belegen, sind noch offen.',
        },
      },
      {
        op: 'add',
        collection: 'targetGroups',
        tempId: 'new:1',
        fields: groupFields('Stammgäste der offenen Werkstatt', 'Jugendliche von 12 bis 17, die regelmäßig kommen und ihr Rad selbst reparieren.', 'Hier will das Projekt seine Hauptwirkung erzielen.'),
      },
      {
        op: 'add',
        collection: 'targetGroups',
        tempId: 'new:2',
        fields: { name: 'Gelegenheitsbesucher', description: 'Kommen ab und zu für eine schnelle Reparatur.', reach: 'direct', isFocus: false, why: 'Oft der Einstieg zu den Stammgästen.' },
      },
      { op: 'add', collection: 'stakeholders', tempId: 'new:3', fields: { role: 'Stiftung Stadtteil Morgen – Geldgeber', expectations: ['Sachbericht mit Teilnahmezahlen pro Halbjahr'] } },
      { op: 'add', collection: 'stakeholders', tempId: 'new:4', fields: { role: 'Nachbarschaftshaus – Träger', expectations: ['Lernen, was die Werkstatt verändert'] } },
      { op: 'add', collection: 'stakeholders', tempId: 'new:5', fields: { role: 'Spenderinnen und Spender der Räder', expectations: ['offen'] } },
      { op: 'add', collection: 'stakeholders', tempId: 'new:6', fields: { role: 'Jugendclub im Einkaufszentrum', expectations: ['offen'] } },
    ],
    { id: 'p1', summary: 'Erster Entwurf aus Schritt 0: Herausforderung, zwei Zielgruppen und die Beteiligten.' },
  )
}

const chat = (proposal: Proposal, text: string): StoredMessage[] => [
  { id: 'g1', at, role: 'user', content: [{ type: 'text', text: 'Die Älteren kommen kaum noch, und die Eltern sind oft mit dabei.' }] },
  {
    id: 'g2',
    at,
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'tool_use', id: proposal.toolUseId, name: 'propose_changes', input: {} },
    ],
  },
]

function withEveryState(): Project {
  const p = filled()
  p.steps[1].block.stakeholders.push(makeItem(1, 'stakeholders', { role: 'Sportverein', expectations: [] }, { id: 'sh3' }))
  p.idCounters = { ...p.idCounters, sh: 3 }
  const proposal = everyState()
  p.steps[1].proposals = [proposal]
  p.steps[1].segments = [{ id: 's1', startedAt: at, messages: chat(proposal, 'Dann trennen wir die Stammgäste von den anderen. Hier ist mein Vorschlag:') }]
  let next = reducer(p, { type: 'change/apply', step: 1, proposalId: 'p1', changeId: 'p1c5' })
  next = reducer(next, { type: 'change/reject', step: 1, proposalId: 'p1', changeId: 'p1c6' })
  return next
}

function withOpening(): Project {
  const p = filled()
  p.steps[1].block = { challenge: makeItem(1, 'challenge', { text: '' }), targetGroups: [], stakeholders: [] }
  const proposal = opening()
  p.steps[1].proposals = [proposal]
  p.steps[1].segments = [{ id: 's1', startedAt: at, messages: chat(proposal, 'Aus Schritt 0 habe ich einen ersten Entwurf gemacht. Schau ihn dir an und übernimm, was passt.') }]
  return p
}

function ProposalScreen({ start }: { start: () => Project }) {
  const [project, setProject] = useState(start)
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 1 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} />
}

export const proposalScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  proposal: { caption: 'Vorschlag: alle Zeilenarten (offen, abhängig, übernommen, abgelehnt, veraltet)', render: () => <ProposalScreen start={withEveryState} /> },
  'proposal-opening': { caption: 'Vorschlag: erster Entwurf mit sieben Änderungen', render: () => <ProposalScreen start={withOpening} /> },
}
