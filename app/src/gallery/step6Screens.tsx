import { useRef, useState, type ReactNode } from 'react'
import { APP_CHECKED } from '../ai/check'
import type { LooseBlock } from '../domain/block'
import { withAppJudged } from '../domain/check'
import { makeItem, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, Proposal, QualityCheck, StoredMessage } from '../domain/schemas/project'
import { App } from '../ui/App'
import type { CheckControls } from '../ui/check/useCheckRunner'
import { step5Project } from './step5Screens'

// Step 6 for the gallery (step 20): what needs a plan row (one indicator still without one),
// four plan rows (a figure-only row, a row sharing two indicators, one half empty), the check,
// a broken reference, a proposal card and a full plan. Made-up content (the "Schraubzeit"
// bike workshop), unlike the guide example and Lukas's case.

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:40:00.000Z'

type RowFields = Partial<Record<'dataSource' | 'method' | 'collector' | 'frequency' | 'firstCollection' | 'consentNote' | 'analysis' | 'why', string>>
const planRow = (id: string, indicatorIds: string[], mandatoryFigureIds: string[], fields: RowFields) =>
  makeItem(6, 'planRows', { indicatorIds, mandatoryFigureIds, dataSource: '', method: '', collector: '', frequency: '', firstCollection: '', consentNote: '', analysis: '', ...fields }, { id })

const attendance: RowFields = {
  dataSource: 'Anwesenheitsliste der Werkstatt (gibt es schon)',
  method: 'nachlesen: am Monatsende die Tage zählen, an denen beide Ehrenamtlichen eingetragen sind',
  collector: 'Teamleitung',
  frequency: 'jeden Monat, zusammengefasst je Quartal',
  firstCollection: 'Ende Januar, für Januar',
  consentNote: 'entfällt, keine Angaben von Personen – nur Tage werden gezählt',
  analysis: 'Teamleitung und Vorstand im Quartalstreffen: reicht die Besetzung, oder suchen wir Ersatz?',
  why: 'Die Liste führen wir ohnehin; das Zählen dauert zehn Minuten.',
}

/** Step 5 confirmed with a third mandatory figure; four plan rows; "Anteil der Stammgäste …" (in2) has no row yet. */
export function step6Project(): Project {
  const p = step5Project()
  p.steps[0].block.frame = { ...p.steps[0].block.frame, existingData: ['Anwesenheitsliste (wer an welchem Tag da war)', 'Reparaturbuch (welches Rad, was gemacht)'] }
  p.steps[5].block.mandatoryFigures.push(makeItem(5, 'mandatoryFigures', { name: 'Anzahl reparierter Räder', target: '120', unit: 'Räder', sourceNote: '' }, { id: 'mf3' }))
  p.steps[5].status = 'confirmed'
  p.steps[5].confirmed = { at, block: structuredClone(p.steps[5].block) as never, basis: {} }
  p.steps[6].status = 'in_progress'
  p.steps[6].block = {
    planRows: [
      planRow('pr1', ['in1'], [], attendance),
      planRow('pr2', [], ['mf1', 'mf2'], {
        dataSource: 'Anwesenheitsliste und Anmeldebogen',
        method: 'nachlesen: Teilnahmen je Person zählen (Kürzel statt Namen), Geschlecht aus dem Anmeldebogen',
        collector: 'Teamleitung',
        frequency: 'zum Halbjahr und zum Jahresende',
        firstCollection: 'Ende Juni',
        consentNote: 'Anmeldebogen mit Einwilligung der Eltern; ausgewertet nur als Summen',
        analysis: 'Teamleitung für den Bericht an die Stiftung',
        why: 'Die Stiftung verlangt beide Zahlen; die Listen haben wir schon.',
      }),
      planRow('pr3', ['in1', 'in3'], [], {
        dataSource: 'Die Stammgäste selbst',
        method: 'fragen: kurzes Gespräch in der Werkstatt – „Was hast du zuletzt selbst repariert?“',
        collector: 'Honorarkraft (nicht die Ehrenamtlichen, die die Werkstatt machen)',
        frequency: 'zweimal im Jahr',
      }),
      // mf9 was deleted in step 5: the chip and the picker show "Verweis fehlt".
      planRow('pr4', [], ['mf3', 'mf9'], { dataSource: 'Reparaturbuch', method: 'nachlesen', collector: 'Ehrenamtliche', frequency: 'jeden Monat', firstCollection: 'Ende Januar', consentNote: 'entfällt, keine Angaben von Personen', analysis: 'Teamleitung im Teamtreffen', why: 'Steht schon im Buch.' }),
    ],
  }
  p.idCounters = { ...p.idCounters, mf: 3, pr: 4 }
  return p
}

function emptyStep6(): Project {
  const p = step6Project()
  p.steps[6].block = { planRows: [] }
  p.steps[6].status = 'not_started'
  p.idCounters = { ...p.idCounters, pr: 0 }
  return p
}

function noneStep6(): Project {
  const p = emptyStep6()
  p.steps[5].block = { ...p.steps[5].block, indicators: [], mandatoryFigures: [] }
  p.steps[5].status = 'in_progress'
  return p
}

/** 6 indicators and 3 figures, 7 rows covering all: the column length with every row closed. */
function fullStep6(): Project {
  const p = step6Project()
  const b = p.steps[5].block
  b.focusQuestions.push(makeItem(5, 'focusQuestions', { text: 'Trauen sich die Mädchen ohne Jungen an das Werkzeug?', reasons: ['kritische_annahme'], audience: 'Team', linkIds: [], goalIds: ['go4'], why: 'w' }, { id: 'fq3' }))
  const ind = (id: string, q: string, text: string) => makeItem(5, 'indicators', { focusQuestionId: q, level: 5, text, baseline: 'ab jetzt', target: 'die Hälfte', why: 'w' }, { id })
  b.indicators.push(ind('in4', 'fq1', 'Zahl der Ausfälle ohne Ersatz je Monat'), ind('in5', 'fq3', 'Anteil der Mädchen, die am Nachmittag selbst schrauben'), ind('in6', 'fq3', 'Was sich die Mädchen nach drei Nachmittagen zutrauen'))
  p.steps[6].block.planRows.push(
    planRow('pr5', ['in2'], [], { ...attendance, dataSource: 'Die Stammgäste selbst', method: 'fragen: Skala vorher – nachher', collector: 'Honorarkraft' }),
    planRow('pr6', ['in4'], [], { ...attendance, method: 'nachlesen: Ausfälle im Kalender zählen' }),
    planRow('pr7', ['in5', 'in6'], [], { ...attendance, dataSource: 'Die Mädchen selbst', method: 'beobachten und fragen: Smiley-Karte nach dem Nachmittag', collector: 'Honorarkraft' }),
  )
  p.idCounters = { ...p.idCounters, fq: 3, in: 6, pr: 7 }
  return p
}

function checked(p: Project): Project {
  const block = structuredClone(p.steps[6].block)
  const claude: QualityCheck['results'] = [
    ...['1', '2', '3', '6', '9', '10'].map((criterion) => ({ criterion, result: 'ok' as const, note: APP_CHECKED })),
    { criterion: '4', result: 'ok', note: 'Anwesenheitsliste und Reparaturbuch sind genutzt.' },
    { criterion: '5', result: 'warn', note: '„Was hast du zuletzt selbst repariert?“ ist gut; „Hat dir die Werkstatt geholfen?“ legt die Antwort nahe.' },
    { criterion: '7', result: 'warn', note: 'Der nachträgliche Ausgangswert der Stammgäste hat noch keinen Termin.' },
    { criterion: '8', result: 'ok', note: 'Wo Personen gefragt werden, ist Einwilligung und Vertraulichkeit geklärt.' },
  ]
  const check: QualityCheck = { at, source: 'app', block, results: withAppJudged(6, block as unknown as LooseBlock, claude, p) } as QualityCheck
  return { ...p, steps: { ...p.steps, 6: { ...p.steps[6], qualityCheck: check as never } } }
}

/**
 * Blocked: rows 1 and 3 without their Why; both of row 2's figures deleted in step 5 → the app's ⚠
 * "Verweis fehlt" (a row without any reference would hold that ⚠ back: criterion 1 is then ⛔).
 */
function blockedStep6(): Project {
  const p = step6Project()
  p.steps[6].block.planRows[0] = { ...p.steps[6].block.planRows[0], why: '' }
  p.steps[5].block.mandatoryFigures = p.steps[5].block.mandatoryFigures.filter((f) => f.id !== 'mf2' && f.id !== 'mf1')
  return checked(p)
}

function proposal(): Proposal {
  const fields = (ids: { indicatorIds?: string[]; mandatoryFigureIds?: string[] }, f: RowFields) => ({
    indicatorIds: [],
    mandatoryFigureIds: [],
    dataSource: '',
    method: '',
    collector: '',
    frequency: '',
    firstCollection: '',
    consentNote: '',
    analysis: '',
    why: '',
    ...ids,
    ...f,
  })
  return {
    ...makeProposal(
      [
        {
          op: 'add',
          collection: 'planRows',
          tempId: 'new:1',
          fields: fields(
            { indicatorIds: ['in2'] },
            {
              dataSource: 'Die Stammgäste selbst',
              method: 'fragen: „Wie war das am Anfang – und wie ist es jetzt?“ (Skala 1–5)',
              collector: 'Honorarkraft',
              frequency: 'einmal zum Jahresende',
              firstCollection: 'Dezember – zugleich der nachträgliche Ausgangswert',
              consentNote: 'mündlich informieren, anonym auf Karten',
              analysis: 'Team im Januar-Treffen: weitermachen oder das Angebot anpassen',
              why: 'Ein Vorher-nachher in einer Frage, ohne zweite Erhebung.',
            },
          ),
        },
        { op: 'add', collection: 'planRows', tempId: 'new:2', fields: fields({ indicatorIds: ['in3'] }, { dataSource: 'Gespräche in der Werkstatt', method: 'fragen: offene Frage, Notizen ohne Namen', collector: 'Honorarkraft', frequency: 'bis zum Sommer, wenn sich etwas ergibt', why: 'Geschichten zeigen das Warum.' }) },
        { op: 'update', collection: 'planRows', targetId: 'pr3', baseRev: 1, fields: { firstCollection: 'März', analysis: 'Honorarkraft und Teamleitung im Teamtreffen danach' } },
      ],
      { id: 'p1', summary: 'Eine Zeile für das Selbst-Flicken mit nachträglichem Ausgangswert, eine für die Geschichten, und Termin und Auswertung für das Gespräch.' },
    ),
    question: 'Kann die Honorarkraft die Karten im Dezember austeilen, oder ist sie dann schon weg?',
  }
}

function withProposal(): Project {
  const p = step6Project()
  const prop = proposal()
  const messages: StoredMessage[] = [
    { id: 'g1', at, role: 'user', content: [{ type: 'text', text: 'Für das Selbst-Flicken fehlt noch was, oder?' }] },
    {
      id: 'g2',
      at,
      role: 'assistant',
      content: [
        { type: 'text', text: 'Ja – dafür gibt es noch keine Zeile. Am einfachsten fragst du die Stammgäste einmal im Dezember nach vorher und nachher.' },
        { type: 'tool_use', id: prop.toolUseId, name: 'propose_changes', input: {} },
      ],
    },
  ]
  p.steps[6].proposals = [prop]
  p.steps[6].segments = [{ id: 's1', startedAt: at, messages }]
  return p
}

function Step6Screen({ start, check }: { start: () => Project; check?: boolean }) {
  const [project, setProject] = useState(start)
  const current = useRef(project)
  current.current = project
  const controls: CheckControls | undefined = check
    ? {
        runs: {},
        check: async () => {
          const next = checked(current.current)
          setProject(next)
          return next.steps[6].qualityCheck
        },
      }
    : undefined
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 6 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} check={controls} />
}

export const step6Screens: Record<string, { caption: string; render: () => ReactNode }> = {
  step6: { caption: 'Schritt 6: was eine Planzeile braucht, vier Planzeilen (zu)', render: () => <Step6Screen start={step6Project} check /> },
  'step6-empty': { caption: 'Schritt 6: noch keine Planzeile', render: () => <Step6Screen start={emptyStep6} /> },
  'step6-none': { caption: 'Schritt 6: Schritt 5 ohne Indikatoren', render: () => <Step6Screen start={noneStep6} /> },
  'step6-blocked': { caption: 'Schritt 6: geprüft, ⛔ und ⚠, Verweis fehlt', render: () => <Step6Screen start={blockedStep6} check /> },
  'step6-proposal': { caption: 'Schritt 6: Vorschlag mit zwei neuen Zeilen und einer Änderung', render: () => <Step6Screen start={withProposal} /> },
  'step6-full': { caption: 'Schritt 6: 9 Indikatoren und Pflichtangaben, 7 Zeilen zu', render: () => <Step6Screen start={fullStep6} /> },
}
