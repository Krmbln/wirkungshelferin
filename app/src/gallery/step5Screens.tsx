import { useRef, useState, type ReactNode } from 'react'
import { APP_CHECKED } from '../ai/check'
import type { LooseBlock } from '../domain/block'
import { withAppJudged } from '../domain/check'
import { makeItem, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, Proposal, QualityCheck, StoredMessage } from '../domain/schemas/project'
import { App } from '../ui/App'
import type { CheckControls } from '../ui/check/useCheckRunner'
import { step4Project } from './step4Screens'

// Step 5 for the gallery (step 19): candidates derived from step 4 (one included, one deferred,
// one open), two questions with their indicators, mandatory figures with the step 0 line, the
// check, an old deferral, an orphan indicator and a proposal card. Made-up content (the
// "Schraubzeit" bike workshop), unlike the guide example and Lukas's case.

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:40:00.000Z'

const question = (id: string, text: string, reasons: string[], audience: string, linkIds: string[], goalIds: string[], why: string) =>
  makeItem(5, 'focusQuestions', { text, reasons: reasons as never, audience, linkIds, goalIds, why }, { id })
const indicator = (id: string, focusQuestionId: string, level: number, text: string, baseline: string, target: string, why: string) =>
  makeItem(5, 'indicators', { focusQuestionId, level: level as never, text, baseline, target, why }, { id })
const figure = (id: string, name: string, target: string, unit = '', sourceNote = '') => makeItem(5, 'mandatoryFigures', { name, target, unit, sourceNote }, { id })

/** Step 4 confirmed; step 5 half done: one candidate in a question, one deferred, one still open. */
export function step5Project(): Project {
  const p = step4Project()
  // The girls' jump is a third candidate: critical and unsure.
  p.steps[4].block.links = p.steps[4].block.links.map((l) => (l.id === 'li8' ? { ...l, critical: true, assumption: 'Ohne Jungen in der Werkstatt trauen sich die Mädchen an das Werkzeug.' } : l))
  p.steps[4].status = 'confirmed'
  p.steps[4].confirmed = { at, block: structuredClone(p.steps[4].block) as never, basis: {} }
  p.steps[0].block.frame = { ...p.steps[0].block.frame, requiredFigures: ['Teilnehmende nach Geschlecht', 'Anzahl der offenen Werkstatttage', 'Anzahl reparierter Räder'] }
  p.steps[5].status = 'in_progress'
  p.steps[5].block = {
    focusQuestions: [
      question(
        'fq1',
        'Bleiben die Ehrenamtlichen das ganze Jahr dabei – auch im Winter?',
        ['kritische_annahme', 'eigenes_lernen'],
        'Vorstand des Fahrradclubs',
        ['li1'],
        [],
        'Fallen sie aus, schließt die Werkstatt; dann suchen wir früh Ersatz.',
      ),
      question('fq2', 'Reparieren die Stammgäste ihr Rad wirklich selbst?', ['geldgeberin'], '', [], ['go2'], 'Das ist der Kern dessen, was die Stiftung fördert.'),
    ],
    deferredCandidates: [makeItem(5, 'deferredCandidates', { linkId: 'li4', reason: 'Das sehen wir jede Woche in der Werkstatt; dafür braucht es keine eigene Frage.' }, { id: 'dc1' })],
    indicators: [
      indicator('in1', 'fq1', 1, 'Anzahl der Öffnungstage, an denen beide Ehrenamtlichen da waren – je Quartal', 'ab jetzt', 'mindestens 20 von 24 Tagen je Quartal', 'Zeigt früh, ob die Besetzung trägt.'),
      indicator(
        'in2',
        'fq2',
        5,
        'Anteil der Stammgäste, die ihr Rad nach einer Panne selbst flicken – zum Ende des Projektjahrs',
        'nachträglich: die Stammgäste schätzen im Dezember ein, wie es vorher war',
        '',
        'Selbst flicken ist das, was sich ändern soll.',
      ),
      indicator('in3', 'fq2', 5, 'Was die Stammgäste über ihr letztes selbst repariertes Rad erzählen', '', 'mindestens 5 Geschichten bis zum Sommer', ''),
    ],
    mandatoryFigures: [
      figure('mf1', 'Teilnehmende nach Geschlecht', '15 Jugendliche, davon mindestens 6 Mädchen', 'Personen', 'Teilnahme = mindestens zweimal im Monat da'),
      figure('mf2', 'Anzahl der offenen Werkstatttage', '80', 'Tage'),
    ],
  }
  p.idCounters = { ...p.idCounters, fq: 2, dc: 1, in: 3, mf: 2 }
  return p
}

function emptyStep5(): Project {
  const p = step5Project()
  p.steps[5].block = { focusQuestions: [], deferredCandidates: [], indicators: [], mandatoryFigures: [] }
  p.steps[5].status = 'not_started'
  p.idCounters = { ...p.idCounters, fq: 0, dc: 0, in: 0, mf: 0 }
  return p
}

/** 3 questions, 6 indicators: every "+" is disabled with its reason. */
function fullStep5(): Project {
  const p = step5Project()
  const b = p.steps[5].block
  b.focusQuestions.push(
    question('fq3', 'Trauen sich die Mädchen ohne Jungen an das Werkzeug?', ['kritische_annahme'], 'Team', [], ['go4'], 'Sonst brauchen wir den Mädchen-Nachmittag gar nicht.'),
  )
  b.indicators.push(
    indicator('in4', 'fq1', 1, 'Zahl der Ausfälle ohne Ersatz je Monat', '2 im letzten Winter', 'höchstens 1', 'Ein Ausfall ohne Ersatz heißt: geschlossen.'),
    indicator('in5', 'fq3', 5, 'Anteil der Mädchen, die am Nachmittag selbst schrauben', 'ab jetzt', 'mindestens die Hälfte', 'Zuschauen allein ist zu wenig.'),
    indicator('in6', 'fq3', 4, 'Was die Mädchen sich nach drei Nachmittagen zutrauen (Selbsteinschätzung)', 'beim ersten Nachmittag', 'deutlich mehr als am Anfang', 'Zutrauen kommt vor dem Tun.'),
  )
  p.idCounters = { ...p.idCounters, fq: 3, in: 6 }
  return p
}

/** An indicator whose question is gone (bad data) and a deferral of a link no longer critical. */
function oldStep5(): Project {
  const p = step5Project()
  p.steps[4].block.links = p.steps[4].block.links.map((l) => (l.id === 'li4' ? { ...l, critical: false } : l))
  p.steps[5].block.indicators.push(indicator('in4', 'fq9', 4, 'Anteil der Jugendlichen, die anderen etwas zeigen', 'ab jetzt', 'ein Drittel', 'Wer erklärt, hat verstanden.'))
  p.idCounters = { ...p.idCounters, in: 4, fq: 9 }
  return p
}

function checked(p: Project): Project {
  const block = structuredClone(p.steps[5].block)
  const claude: QualityCheck['results'] = [
    // What the app owns comes back as APP_CHECKED (parseCheck fills it in), then the app judges it.
    ...['1', '2', '3', '5', '6', '11', '12', '13'].map((criterion) => ({ criterion, result: 'ok' as const, note: APP_CHECKED })),
    { criterion: '4', result: 'ok', note: 'Der Lernwunsch aus dem Messrahmen steckt in Frage 2.' },
    { criterion: '7', result: 'warn', note: '„Was die Stammgäste erzählen“ nennt keinen Zeitpunkt.' },
    { criterion: '8', result: 'ok', note: 'Die Stufen passen zu Zielen und Annahmen.' },
    { criterion: '9', result: 'ok', note: 'Selbst flicken ist eine Veränderung bei Menschen.' },
    { criterion: '10', result: 'ok', note: 'Zählbares und Geschichten gemischt.' },
    { criterion: '10a', result: 'warn', note: 'Für die Mädchen gibt es keine Lernfrage und keine Begründung.' },
  ]
  const check: QualityCheck = { at, source: 'app', block, results: withAppJudged(5, block as unknown as LooseBlock, claude, p) } as QualityCheck
  return { ...p, steps: { ...p.steps, 5: { ...p.steps[5], qualityCheck: check as never } } }
}

/** Blocked: question 2 lost its Why, question 1 has no indicator and no reference left. */
function blockedStep5(): Project {
  const p = step5Project()
  const b = p.steps[5].block
  b.focusQuestions = b.focusQuestions.map((q) => (q.id === 'fq1' ? { ...q, linkIds: [] } : { ...q, why: '' }))
  b.indicators = b.indicators.filter((i) => i.focusQuestionId !== 'fq1').map((i) => (i.id === 'in2' ? { ...i, baseline: '' } : i))
  return checked(p)
}

function proposal(): Proposal {
  return {
    ...makeProposal(
      [
        {
          op: 'add',
          collection: 'focusQuestions',
          tempId: 'new:1',
          fields: { text: 'Trauen sich die Mädchen ohne Jungen an das Werkzeug?', reasons: ['kritische_annahme'], audience: 'Team und Vorstand', linkIds: ['li8'], goalIds: ['go4'], why: 'Sonst brauchen wir den Mädchen-Nachmittag nicht.' },
        },
        {
          op: 'add',
          collection: 'indicators',
          tempId: 'new:2',
          fields: { focusQuestionId: 'new:1', level: 5, text: 'Anteil der Mädchen, die am Nachmittag selbst schrauben – zum Sommer', baseline: 'ab jetzt', target: 'mindestens die Hälfte', why: 'Zuschauen allein ist zu wenig.' },
        },
        {
          op: 'add',
          collection: 'indicators',
          tempId: 'new:3',
          fields: { focusQuestionId: 'fq1', level: 1, text: 'Zahl der Ausfälle ohne Ersatz je Monat', baseline: '2 im letzten Winter', target: 'höchstens 1', why: 'Ein Ausfall ohne Ersatz heißt: geschlossen.' },
        },
        { op: 'add', collection: 'mandatoryFigures', tempId: 'new:4', fields: { name: 'Anzahl reparierter Räder', target: '120', unit: 'Räder', sourceNote: '' } },
        { op: 'update', collection: 'deferredCandidates', targetId: 'dc1', baseRev: 1, fields: { reason: 'Das sehen wir jede Woche; die Ehrenamtlichen erzählen es uns.' } },
      ],
      { id: 'p1', summary: 'Eine Lernfrage für die Mädchen mit Indikator, ein zweiter Indikator für Frage 1, die fehlende Pflichtangabe und ein genauerer Grund fürs Zurückstellen.' },
    ),
    question: 'Wer im Team kann sagen, ob die Mädchen selbst schrauben – oder fragen wir sie direkt?',
  }
}

/** The card with one more question while 2 are there, and Frage 1 already full by hand (its indicator waits). */
function withProposal(): Project {
  const p = step5Project()
  p.steps[5].block.indicators.push(indicator('in4', 'fq1', 1, 'Zahl der Ausfälle im Winter', '', '', ''))
  p.idCounters = { ...p.idCounters, in: 4 }
  const prop = proposal()
  const messages: StoredMessage[] = [
    { id: 'g1', at, role: 'user', content: [{ type: 'text', text: 'Und die Mädchen? Dazu haben wir noch gar keine Frage.' }] },
    {
      id: 'g2',
      at,
      role: 'assistant',
      content: [
        { type: 'text', text: 'Stimmt – die Annahme zum Mädchen-Nachmittag ist noch offen. Ich nehme sie als eigene Lernfrage auf.' },
        { type: 'tool_use', id: prop.toolUseId, name: 'propose_changes', input: {} },
      ],
    },
  ]
  p.steps[5].proposals = [prop]
  p.steps[5].segments = [{ id: 's1', startedAt: at, messages }]
  return p
}

function Step5Screen({ start, check }: { start: () => Project; check?: boolean }) {
  const [project, setProject] = useState(start)
  const current = useRef(project)
  current.current = project
  const controls: CheckControls | undefined = check
    ? {
        runs: {},
        check: async () => {
          const next = checked(current.current)
          setProject(next)
          return next.steps[5].qualityCheck
        },
      }
    : undefined
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 5 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} check={controls} />
}

export const step5Screens: Record<string, { caption: string; render: () => ReactNode }> = {
  step5: { caption: 'Schritt 5: Kandidaten, Lernfragen mit Indikatoren, Pflichtangaben', render: () => <Step5Screen start={step5Project} check /> },
  'step5-empty': { caption: 'Schritt 5: noch leer, alle Kandidaten offen', render: () => <Step5Screen start={emptyStep5} /> },
  'step5-full': { caption: 'Schritt 5: 3 Fragen, 6 Indikatoren – jedes „+“ mit Grund gesperrt', render: () => <Step5Screen start={fullStep5} /> },
  'step5-blocked': { caption: 'Schritt 5: geprüft, ⛔ und ⚠', render: () => <Step5Screen start={blockedStep5} check /> },
  'step5-old': { caption: 'Schritt 5: alte Zurückstellung und Indikator ohne Lernfrage', render: () => <Step5Screen start={oldStep5} /> },
  'step5-proposal': { caption: 'Schritt 5: Vorschlag mit Lernfrage, Indikatoren und Pflichtangabe; ein Indikator wartet', render: () => <Step5Screen start={withProposal} /> },
}
