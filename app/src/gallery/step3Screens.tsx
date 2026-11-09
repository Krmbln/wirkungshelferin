import { useRef, useState, type ReactNode } from 'react'
import { APP_CHECKED } from '../ai/check'
import type { LooseBlock } from '../domain/block'
import { withAppJudged } from '../domain/check'
import { makeItem, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, Proposal, QualityCheck, StoredMessage } from '../domain/schemas/project'
import { App } from '../ui/App'
import type { CheckControls } from '../ui/check/useCheckRunner'
import { step2Project } from './step2Screens'

// Step 3 for the gallery (step 17): goals per focus group at levels 6 → 5 → 4, a "trifft nicht
// zu" mark, a broken link, non-focus groups (one without core problem), Stufe 7 and a proposal
// card. Made-up content (the "Schraubzeit" bike workshop), unlike the guide example and Lukas's
// case. Stateful, so the review can click (e.g. open a cause picker).

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:40:00.000Z'

const goal = (id: string, groupId: string, level: 4 | 5 | 6, text: string, causeIds: string[], timeFrame: string, why: string) =>
  makeItem(3, 'goals', { groupId, level, text, causeIds, timeFrame, why }, { id })

/** Step 2 confirmed; step 3 mostly filled, with the gaps the check should find. */
export function step3Project(): Project {
  const p = step2Project()
  p.steps[2].status = 'confirmed'
  p.steps[2].confirmed = { at, block: structuredClone(p.steps[2].block) as never, basis: {} }
  p.steps[3].status = 'in_progress'
  p.steps[3].block = {
    goals: [
      goal(
        'go1',
        'tg1',
        6,
        'Jugendliche aus der Siedlung, die jede Woche in die Werkstatt kommen, sind nachmittags mit dem eigenen Rad unterwegs, statt vor dem Einkaufszentrum zu warten.',
        ['ca1'],
        'bis Ende 2027',
        'Das ist die Lage, die sich ändern soll: rauskommen und selbst etwas schaffen.',
      ),
      goal('go2', 'tg1', 5, 'Die Stammgäste reparieren ihr Rad selbst, statt es stehen zu lassen.', ['ca2', 'ca4'], 'bis Ende des Projektjahrs', ''),
      goal('go3', 'tg1', 4, 'Die Stammgäste können einen Platten flicken und die Bremsen einstellen.', ['ca4'], '', 'Ohne dieses Können gibt es kein Selbermachen.'),
      goal('go4', 'tg3', 5, 'Mädchen aus der Siedlung arbeiten an den offenen Nachmittagen selbst am Werkzeug.', ['ca5', 'ca9'], 'bis zum Sommer', 'Sie sollen nicht nur zuschauen.'),
      goal('go5', 'tg2', 4, 'Eltern wissen, was ihre Kinder in der Werkstatt lernen.', [], 'bis Ende 2026', 'Dann lassen sie die Jüngeren eher kommen.'),
    ],
    levelNotApplicable: [
      makeItem(3, 'levelNotApplicable', { groupId: 'tg3', level: 6, why: 'Die Lebenslage der Mädchen ändert die Werkstatt allein nicht; uns geht es um ihr Handeln vor Ort.' }, { id: 'na1' }),
    ],
    level7: makeItem(3, 'level7', { text: 'Das Projekt trägt dazu bei, dass Jugendliche in der Siedlung mehr eigene Wege gehen können.', why: '' }, { id: 'level7' }),
  }
  p.idCounters = { ...p.idCounters, go: 5, na: 1 }
  return p
}

function emptyStep3(): Project {
  const p = step3Project()
  p.steps[3].block = { goals: [], levelNotApplicable: [], level7: makeItem(3, 'level7', { text: '', why: '' }, { id: 'level7' }) }
  p.steps[3].status = 'not_started'
  return p
}

function noFocus(): Project {
  const p = step3Project()
  for (const g of p.steps[1].block.targetGroups) g.isFocus = false
  p.steps[1].status = 'in_progress'
  return p
}

function checked(p: Project): Project {
  const block = structuredClone(p.steps[3].block)
  const claude: QualityCheck['results'] = [
    { criterion: '1', result: 'ok', note: 'Jedes Ziel beschreibt eine Veränderung bei Menschen.' },
    { criterion: '2', result: 'ok', note: 'Gruppe zuerst, erreichter Zustand, positiv.' },
    { criterion: '3', result: 'ok', note: 'Die Stufen passen zum Inhalt.' },
    { criterion: '4', result: 'ok', note: APP_CHECKED },
    { criterion: '5', result: 'ok', note: APP_CHECKED },
    { criterion: '6', result: 'ok', note: APP_CHECKED },
    { criterion: '7', result: 'warn', note: '„Die Stammgäste“ ist noch nicht genau beschrieben – wer zählt dazu?' },
    { criterion: '8', result: 'ok', note: 'Ein Satz mit „trägt dazu bei“, aus der Herausforderung abgeleitet.' },
    { criterion: '9', result: 'ok', note: APP_CHECKED },
    { criterion: '10', result: 'ok', note: APP_CHECKED },
  ]
  const check: QualityCheck = { at, source: 'app', block, results: withAppJudged(3, block as unknown as LooseBlock, claude, p) } as QualityCheck
  return { ...p, steps: { ...p.steps, 3: { ...p.steps[3], qualityCheck: check as never } } }
}

function proposal(): Proposal {
  return makeProposal(
    [
      {
        op: 'add',
        collection: 'goals',
        tempId: 'new:1',
        fields: { groupId: 'tg3', level: 4, text: 'Mädchen trauen sich, an der Werkbank nach Hilfe zu fragen.', causeIds: ['ca5'], timeFrame: 'bis zum Sommer', why: 'Fragen ist der erste Schritt, bevor sie selbst schrauben.' },
      },
      { op: 'update', collection: 'goals', targetId: 'go2', baseRev: 1, fields: { causeIds: ['ca2'], timeFrame: 'bis Ende 2026' } },
      { op: 'remove', collection: 'levelNotApplicable', targetId: 'na1', baseRev: 1 },
      {
        op: 'add',
        collection: 'goals',
        tempId: 'new:2',
        fields: { groupId: 'tg3', level: 6, text: 'Mädchen aus der Siedlung haben einen Ort am Nachmittag, an dem sie sich sicher fühlen.', causeIds: ['ca5'], timeFrame: 'bis Ende 2027', why: '' },
      },
      { op: 'update', collection: 'level7', targetId: 'level7', baseRev: 1, fields: { text: 'Das Projekt trägt dazu bei, dass Jugendliche in der Siedlung eigene Wege gehen und Neues ausprobieren.' } },
    ],
    { id: 'p1', summary: 'Ein Stufe-4-Ziel für die Mädchen, ein Stufe-6-Ziel statt „trifft nicht zu“ und ein genauerer Beitrag.' },
  )
}

function withProposal(): Project {
  const p = step3Project()
  const prop = proposal()
  const messages: StoredMessage[] = [
    { id: 'g1', at, role: 'user', content: [{ type: 'text', text: 'Für die Mädchen fehlt noch was auf Stufe 4. Und eigentlich geht es doch um einen sicheren Ort für sie.' }] },
    {
      id: 'g2',
      at,
      role: 'assistant',
      content: [
        {
          type: 'text',
          text:
            'Dann würde ich Stufe 6 für die Mädchen doch mit einem Ziel füllen und die Markierung „trifft nicht zu“ entfernen.\n\n' +
            'Für den sicheren Ort fehlt in Schritt 2 noch eine Ursache, an die das Ziel anschließen kann – bisher steht dort nur, dass Werkstätten als Ort für Jungen gelten.\n[Zu Schritt 2](#schritt-2)\n\n' +
            'Passt „sicher fühlen“ zu dem, was ihr beobachtet?',
        },
        { type: 'tool_use', id: prop.toolUseId, name: 'propose_changes', input: {} },
      ],
    },
  ]
  p.steps[3].proposals = [prop]
  p.steps[3].segments = [{ id: 's1', startedAt: at, messages }]
  return p
}

function Step3Screen({ start, check }: { start: () => Project; check?: boolean }) {
  const [project, setProject] = useState(start)
  const current = useRef(project)
  current.current = project
  const controls: CheckControls | undefined = check
    ? {
        runs: {},
        check: async () => {
          const next = checked(current.current)
          setProject(next)
          return next.steps[3].qualityCheck
        },
      }
    : undefined
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 3 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} check={controls} />
}

export const step3Screens: Record<string, { caption: string; render: () => ReactNode }> = {
  step3: { caption: 'Schritt 3: Ziele je Stufe, „trifft nicht zu“, weitere Zielgruppen, Stufe 7', render: () => <Step3Screen start={step3Project} check /> },
  'step3-empty': { caption: 'Schritt 3: noch leer', render: () => <Step3Screen start={emptyStep3} /> },
  'step3-nofocus': { caption: 'Schritt 3: keine Fokusgruppe in Schritt 1', render: () => <Step3Screen start={noFocus} /> },
  'step3-blocked': { caption: 'Schritt 3: geprüft, ⛔ und ⚠ (Verweis fehlt, Zeitrahmen fehlt)', render: () => <Step3Screen start={() => checked(step3Project())} check /> },
  'step3-proposal': { caption: 'Schritt 3: Vorschlag mit Zielen, Markierung entfernen und „Zu Schritt 2“ im Chat', render: () => <Step3Screen start={withProposal} /> },
}
