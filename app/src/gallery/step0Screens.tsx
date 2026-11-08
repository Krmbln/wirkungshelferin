import { useRef, useState, type ReactNode } from 'react'
import { rubricCriteria } from '../ai/tools'
import { makeItem, makeProject, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, Proposal, StoredMessage } from '../domain/schemas/project'
import { App } from '../ui/App'
import type { ReadPdf } from '../ui/chat/PdfImport'
import type { ChatControls } from '../ui/chat/useChatRunner'
import type { CheckControls } from '../ui/check/useCheckRunner'
import { opening as openingDraft } from './proposalScreens'

// Step 0 for the gallery (step 14): start panel, paste form, first-draft card, the form's
// three field states, sources, the check and the hand-off. Made-up content (the "Schraubzeit"
// bike workshop of demo.ts) with real-length texts (lessons-learned, step 13). Stateful like
// the Session: the fake chat answers the step 1 opening after a moment.

const galleryNow = new Date('2026-11-08T12:00:00')
const at = '2026-11-08T11:40:00.000Z'

const APPLICATION = `Projektskizze „Schraubzeit – offene Fahrradwerkstatt für Jugendliche“

Träger: Nachbarschaftshaus Am Weidengrund e. V.
Ort: Weidengrund-Siedlung, Großwohnsiedlung am Stadtrand, Räume im Erdgeschoss des Nachbarschaftshauses.

Ausgangslage: Viele Jugendliche der Siedlung verlassen ihr Wohnumfeld selten. Busse fahren abends nur stündlich, eigene Räder sind oft kaputt oder fehlen.

Angebot: Zweimal pro Woche (dienstags und donnerstags, 15–18 Uhr) öffnet die Werkstatt. Jugendliche reparieren ihre eigenen Räder unter Anleitung. Wer 20 Stunden mitarbeitet, darf ein aufbereitetes Spendenrad behalten. In den Ferien gibt es Touren in die Umgebung.

Ziele: Die Jugendlichen werden mobiler und kommen auch in andere Stadtteile. Sie können ihr Rad selbst instand halten.

Laufzeit: 2026–2027. Finanzierung: Stiftung Stadtteil Morgen.`

const profileDraft = {
  name: 'Schraubzeit – offene Fahrradwerkstatt für Jugendliche',
  organisation: 'Nachbarschaftshaus Am Weidengrund e. V.',
  projectBoundary: 'Die offene Werkstatt dienstags und donnerstags; die Ferientouren nur, soweit dieselben Jugendlichen mitfahren.',
  location: 'Weidengrund-Siedlung, Großwohnsiedlung am Stadtrand; Räume im Erdgeschoss des Nachbarschaftshauses',
  activities: [
    'Offene Werkstatt zweimal pro Woche: eigene Räder reparieren mit Anleitung',
    'Spendenräder aufbereiten; nach 20 Stunden Mitarbeit darf man eins behalten',
    'Touren in die Umgebung in den Ferien',
  ],
  participants: 'Jugendliche aus der Siedlung; Alter und Zahl laut Skizze nicht genannt',
  team: 'offen',
  duration: '2026–2027',
  funder: 'Stiftung Stadtteil Morgen',
  budgetRange: '',
  statedGoals: ['Die Jugendlichen werden mobiler und kommen auch in andere Stadtteile', 'Sie können ihr Rad selbst instand halten'],
  otherOffers: ['offen'],
  openQuestions: ['Wie viele Jugendliche kommen regelmäßig? – weiß das Team', 'Wer macht die Werkstatt (haupt-, ehrenamtlich)? – weiß der Träger'],
}

const source = () => makeItem(0, 'sources', { origin: 'paste', label: 'Projektskizze Schraubzeit 2026', text: APPLICATION, at }, { id: 'src1' })

const pasteTurn = (): StoredMessage => ({
  id: 'g1',
  at,
  role: 'user',
  act: { kind: 'paste', label: 'Projektskizze Schraubzeit 2026', chars: APPLICATION.length },
  content: [{ type: 'text', text: '[App] …' }, { type: 'text', text: '[Bausteinstand Schritt 0]' }],
})

const answer = (proposal: Proposal, text: string): StoredMessage => ({
  id: 'g2',
  at,
  role: 'assistant',
  content: [
    { type: 'text', text },
    { type: 'tool_use', id: proposal.toolUseId, name: 'propose_changes', input: {} },
  ],
})

/** Step 0 right after the paste: the first-draft card, profile still empty. */
function withDraft(): Project {
  const proposal = makeProposal([{ op: 'update', collection: 'profile', targetId: 'profile', baseRev: 1, fields: profileDraft }], {
    id: 'p1',
    summary: 'Ein erstes Profil aus deiner Projektskizze; was sie nicht sagt, steht als offen da.',
  })
  const p = makeProject({ steps: { 0: { status: 'in_progress', proposals: [proposal], block: { sources: [source()] } } } })
  const reply =
    'Danke, das ist eine gute Grundlage. Name, Träger, Ort, Angebot und Ziele stehen in der Skizze (Abschnitte „Angebot“ und „Ziele“). Wer im Team arbeitet und welche ähnlichen Angebote es gibt, steht nicht drin – das habe ich als offen markiert.\n\nWie läuft die Teilnahme: feste Gruppe mit Anmeldung, oder kommen und gehen die Jugendlichen?'
  p.steps[0].segments = [{ id: 's1', startedAt: at, messages: [pasteTurn(), answer(proposal, reply)] }]
  return p
}

/** The draft applied, then edited: chips for "offen", a few fields still leer, the frame half done. */
function withProfile(): Project {
  let p = reducer(withDraft(), { type: 'change/apply', step: 0, proposalId: 'p1', changeId: 'p1c1' })
  p = reducer(p, { type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields: { duration: '' } })
  p = reducer(p, { type: 'item/edit', step: 0, collection: 'frame', id: 'frame', fields: { purpose: 'beides', audience: 'Stiftung Stadtteil Morgen und das Team' } })
  return p
}

/** A change once the profile has content: fields that were empty listed, filled ones old → new. */
function withChange(): Project {
  const p = withProfile()
  const proposal = makeProposal(
    [
      {
        op: 'update',
        collection: 'profile',
        targetId: 'profile',
        baseRev: p.steps[0].block.profile.rev,
        fields: { participants: 'Jugendliche von 12 bis 17 aus der Siedlung; etwa 10 Stammgäste, dazu viele, die nur ab und zu kommen', duration: '2026–2027, Verlängerung offen' },
      },
    ],
    { id: 'p2', summary: 'Die Teilnahme genauer, wie du sie beschrieben hast.' },
  )
  p.steps[0].proposals.push(proposal)
  const segment = p.steps[0].segments[0]
  segment.messages.push(
    { id: 'g3', at, role: 'user', content: [{ type: 'text', text: 'Etwa zehn kommen fast immer, die anderen ab und zu. Alle zwischen 12 und 17.' }, { type: 'text', text: '[Baustein unverändert]' }] },
    { ...answer(proposal, 'Dann trage ich das so ein. Die Laufzeit hattest du gelöscht – ich schlage sie mit einem Hinweis wieder vor.'), id: 'g4' },
  )
  return p
}

const results = (step: 0 | 1) => rubricCriteria(step).map((c) => ({ criterion: c.id, result: 'ok' as const, note: 'Passt.' }))

/** Everything filled or offen except two fields: the app's completeness ⚠ with "Zum Feld". */
function withCheck(full = false): Project {
  let p = withProfile()
  p = reducer(p, {
    type: 'item/edit',
    step: 0,
    collection: 'frame',
    id: 'frame',
    fields: { requiredFormat: 'offen', requiredFigures: ['Teilnahmen pro Halbjahr'], existingData: ['Anwesenheitsliste pro Nachmittag (zählt Besuche, nicht Personen)'] },
  })
  if (full) p = reducer(p, { type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields: { duration: '2026–2027' } })
  return reducer(p, { type: 'check/store', step: 0, check: { at, source: 'app', block: structuredClone(p.steps[0].block), results: results(0) } })
}

const opening = (): StoredMessage => ({ id: 'o1', at, role: 'user', act: { kind: 'opening' }, content: [{ type: 'text', text: '[App] …' }, { type: 'text', text: '[Bausteinstand Schritt 1]' }] })

/** Step 15: the PDF reader's outcomes. The gallery spec picks a file to start one. */
const readers: Record<'reading' | 'failed' | 'partial', ReadPdf> = {
  // Reads "forever" (until Stopp), with a count already shown.
  reading: (_base64, { signal, onProgress }) => {
    onProgress(12_400)
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ status: 'aborted', text: '', rounds: 0 })))
  },
  failed: async () => ({ status: 'failed', problem: 'other', text: '', rounds: 0 }),
  partial: async () => ({ status: 'incomplete', text: APPLICATION.repeat(6), rounds: 4 }),
}

/** Step 0 after a PDF: the app line and the source say so. */
function withPdfDraft(): Project {
  const p = withDraft()
  const label = 'Projektantrag Schraubzeit 2026'
  ;(p.steps[0].block.sources as { origin: string; label: string }[])[0] = { ...p.steps[0].block.sources[0], origin: 'pdf', label } as never
  p.steps[0].segments[0].messages[0].act = { kind: 'pdf', label, chars: APPLICATION.length }
  return p
}

function Step0Screen({ start, step = 0, draftMs = 1500, pdf = 'reading' }: { start: () => Project; step?: 0 | 1; draftMs?: number; pdf?: keyof typeof readers }) {
  const [project, setProject] = useState(start)
  const [runs, setRuns] = useState<ChatControls['runs']>({})
  const current = useRef(project)
  current.current = project
  const chat: ChatControls = {
    runs,
    send: () => {},
    stop: () => {},
    retry: () => {},
    // The step 1 opening: "writes" for a moment, then the draft is there.
    act: (s, act) => {
      if (s !== 1 || act.kind !== 'opening') return
      setProject((p) => {
        const next = structuredClone(p)
        next.steps[1].segments = [{ id: 'o', startedAt: at, messages: [opening()] }]
        return next
      })
      setRuns({ 1: { kind: 'running', blocks: [] } })
      setTimeout(() => {
        setProject((p) => {
          const next = structuredClone(p)
          next.steps[1].segments[0].messages.push({ id: 'o2', at, role: 'assistant', content: [{ type: 'text', text: 'Aus Schritt 0 habe ich einen ersten Entwurf gemacht.' }] })
          return next
        })
        setRuns({})
      }, draftMs)
    },
  }
  const check: CheckControls = {
    runs: {},
    check: async () => {
      const p = current.current
      const next = reducer(p, { type: 'check/store', step: 0, check: { at: new Date().toISOString(), source: 'app', block: structuredClone(p.steps[0].block), results: results(0) } })
      setProject(next)
      return next.steps[0].qualityCheck
    },
  }
  return (
    <App
      now={galleryNow}
      project={project}
      initialView={{ kind: 'step', step }}
      onBlockAction={(a) => setProject((p) => reducer(p, a))}
      chat={chat}
      check={check}
      readPdf={readers[pdf]}
    />
  )
}

function afterHandoff(): Project {
  const p = withCheck(true)
  const confirmed = reducer(p, { type: 'step/confirm', step: 0, at })
  const draft = openingDraft()
  confirmed.steps[1].proposals = [draft]
  confirmed.steps[1].segments = [
    {
      id: 'o',
      startedAt: at,
      messages: [
        opening(),
        {
          id: 'o2',
          at,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Aus deiner Projektskizze habe ich einen ersten Entwurf gemacht: eine Herausforderung und zwei Gruppen, die Stammgäste als Fokusgruppe.\n\nIn der Skizze steht „Jugendliche“. Sind es wirklich alle zwischen 12 und 17 – oder vor allem die Jüngeren, die noch kein eigenes Rad haben?',
            },
            { type: 'tool_use', id: draft.toolUseId, name: 'propose_changes', input: {} },
          ],
        },
      ],
    },
  ]
  confirmed.steps[1].status = 'in_progress'
  return confirmed
}

export const step0Screens: Record<string, { caption: string; render: () => ReactNode }> = {
  'step0-empty': { caption: 'Schritt 0 leer: Startfeld, leeres Formular mit Hinweis', render: () => <Step0Screen start={() => makeProject()} /> },
  'step0-draft': { caption: 'Schritt 0: Text eingefügt, erster Entwurf als NEU-Zeile', render: () => <Step0Screen start={withDraft} /> },
  'step0-profile': { caption: 'Schritt 0: Profil mit „offen“, leeren Feldern, Quelle', render: () => <Step0Screen start={withProfile} /> },
  'step0-change': { caption: 'Schritt 0: ÄNDERN, sobald das Profil Inhalt hat', render: () => <Step0Screen start={withChange} /> },
  'step0-check': { caption: 'Schritt 0: Qualitätscheck, Vollständigkeit ⚠ mit „Zum Feld“', render: () => <Step0Screen start={() => withCheck()} /> },
  'step0-ready': { caption: 'Schritt 0: geprüft, alles erfüllt – Bestätigen startet Schritt 1', render: () => <Step0Screen start={() => withCheck(true)} /> },
  'step0-pdf-failed': { caption: 'Schritt 0: PDF ließ sich nicht lesen (nach dem Hochladen)', render: () => <Step0Screen start={() => makeProject()} pdf="failed" /> },
  'step0-pdf-partial': { caption: 'Schritt 0: PDF nur zum Teil gelesen – Einfügeformular mit Hinweis', render: () => <Step0Screen start={() => makeProject()} pdf="partial" /> },
  'step0-pdf-draft': { caption: 'Schritt 0: PDF gelesen, erster Entwurf', render: () => <Step0Screen start={withPdfDraft} /> },
  'step1-handoff': { caption: 'Schritt 1 nach der Übergabe: App-Zeile, Entwurf, Intro offen', render: () => <Step0Screen start={afterHandoff} step={1} /> },
}
