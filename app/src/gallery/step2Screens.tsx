import { useRef, useState, type ReactNode } from 'react'
import { makeItem, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'

import type { Project, Proposal, QualityCheck, StoredMessage } from '../domain/schemas/project'
import { App } from '../ui/App'
import type { CheckControls } from '../ui/check/useCheckRunner'
import { filled } from './blockScreens'

// Step 2 for the gallery (step 16): the multi-group layout with two focus groups, nested causes,
// the edge states and a step 2 proposal card. Made-up content (the "Schraubzeit" bike workshop
// of demo.ts), unlike the guide example and Lukas's case. Stateful, so the review can click.

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:40:00.000Z'

const cause = (id: string, groupId: string, parentId: string, text: string, evidence: string, why: string, notInfluenceable = false) =>
  makeItem(2, 'causes', { groupId, parentId, text, evidence: evidence as never, notInfluenceable, why }, { id })

/** Step 1 confirmed with two focus groups (tg1, tg3) and two others (tg2, tg4); step 2 filled. */
export function step2Project(): Project {
  const p = filled()
  const groups = p.steps[1].block.targetGroups
  groups.push(
    makeItem(
      1,
      'targetGroups',
      {
        name: 'Mädchen 11–14 aus der Siedlung',
        description: 'Kommen seltener, meist zu zweit, und schauen oft erst eine Weile zu.',
        reach: 'direct',
        isFocus: true,
        why: 'Die Werkstatt will gezielt mehr Mädchen erreichen.',
      },
      { id: 'tg3' },
    ),
    makeItem(1, 'targetGroups', { name: 'Nachbarinnen und Nachbarn', description: 'Sehen die Werkstatt vom Hof aus.', reach: 'indirect', why: 'Sie prägen, wie die Siedlung über die Jugendlichen redet.' }, { id: 'tg4' }),
  )
  groups[1] = { ...groups[1], why: 'Ohne ihre Erlaubnis kommen die Jüngeren nicht.' }
  p.steps[1].status = 'confirmed'
  p.steps[2].status = 'in_progress'
  p.steps[2].block = {
    problems: [
      makeItem(
        2,
        'problems',
        {
          groupId: 'tg1',
          coreProblem: 'Jugendliche aus der Siedlung verbringen die Nachmittage meist drinnen oder vor dem Einkaufszentrum und erleben selten, dass sie etwas selbst schaffen.',
          why: 'Das erzählen die Ehrenamtlichen aus den Gesprächen in der Werkstatt; viele sagen, sie wüssten nachmittags nicht wohin.',
        },
        { id: 'pb1' },
      ),
      makeItem(
        2,
        'problems',
        {
          groupId: 'tg3',
          coreProblem: 'Mädchen aus der Siedlung trauen sich in der offenen Werkstatt kaum an das Werkzeug, wenn viele Jungen da sind.',
          why: 'Beobachtung an den Nachmittagen: Sie schauen zu, fragen aber nicht nach.',
        },
        { id: 'pb2' },
      ),
      makeItem(2, 'problems', { groupId: 'tg2', coreProblem: 'Eltern wissen wenig darüber, was ihre Kinder nachmittags machen und lernen.', why: '' }, { id: 'pb3', rev: 2, editedByUser: true }),
    ],
    causes: [
      cause('ca1', 'tg1', '', 'Viele haben kein funktionierendes Rad und kommen ohne Bus kaum aus der Siedlung heraus.', 'eigene_erfahrung', 'Etwa die Hälfte der Jugendlichen kommt zu Fuß und fragt nach Leihrädern.'),
      cause('ca2', 'tg1', 'ca1', 'Reparaturen im Fahrradladen sind für die Familien zu teuer.', 'eigene_erfahrung', ''),
      cause('ca3', 'tg1', 'ca2', 'Viele Familien in der Siedlung leben von Sozialleistungen.', 'forschung', 'Sozialbericht des Bezirks 2025: mehr als 40 % der Haushalte beziehen Leistungen.', true),
      cause('ca4', 'tg1', '', 'Kaum Erwachsene in ihrem Umfeld zeigen ihnen handwerkliche Dinge.', 'unsicher', 'Vermutung aus der Werkstatt, noch nicht nachgefragt.'),
      cause('ca5', 'tg3', '', 'Werkstätten gelten in vielen Familien als Ort für Jungen.', 'eigene_erfahrung', 'Zwei Mütter haben das beim Sommerfest so gesagt.'),
    ],
    consequences: [
      makeItem(2, 'consequences', { groupId: 'tg1', parentId: '', text: 'Sie trauen sich wenig zu und probieren seltener Neues aus.' }, { id: 'co1' }),
      makeItem(2, 'consequences', { groupId: 'tg1', parentId: 'co1', text: 'Ihre Chancen auf eine Ausbildung im Handwerk sinken.' }, { id: 'co2' }),
    ],
  }
  p.idCounters = { ...p.idCounters, tg: 4, pb: 3, ca: 5, co: 2 }
  p.steps[1].confirmed = { at, block: structuredClone(p.steps[1].block) as never, basis: {} }
  return p
}

/** No content yet, groups from step 1. */
function emptyStep2(): Project {
  const p = step2Project()
  p.steps[2].block = { problems: [], causes: [], consequences: [] }
  p.steps[2].status = 'not_started'
  return p
}

/** Step 1 has groups but none is a focus group (step 1 unconfirmed). */
function noFocus(): Project {
  const p = step2Project()
  for (const g of p.steps[1].block.targetGroups) g.isFocus = false
  p.steps[1].status = 'in_progress'
  return p
}

/** The girls were un-marked as focus group: their cause is hidden. */
function hidden(): Project {
  const p = step2Project()
  p.steps[1].block.targetGroups.find((g) => g.id === 'tg3')!.isFocus = false
  return p
}

function checked(p: Project): Project {
  const check: QualityCheck = {
    at,
    source: 'app',
    block: structuredClone(p.steps[2].block),
    results: [
      { criterion: '1', result: 'ok', note: 'Aus Sicht der Gruppen, konkret und ohne Lösung.' },
      { criterion: '2', result: 'warn', note: 'Für „Mädchen 11–14“ gibt es erst eine Ursache.' },
      { criterion: '3', result: 'ok', note: 'Alle Ursachen beschreiben Zustände.' },
      { criterion: '4', result: 'ok', note: 'Die Lage der Familien ist als nicht beeinflussbar vermerkt.' },
      { criterion: '5', result: 'warn', note: 'Für die Mädchen fehlen Folgen.' },
      { criterion: '6', result: 'ok', note: 'Jede Ursache hat eine Evidenzbasis.' },
      { criterion: '7', result: 'ok', note: 'Die Kette wurde im Chat vorgelesen und bestätigt.' },
      { criterion: '8', result: 'ok', note: 'Die Eltern haben ein Kernproblem.' },
    ],
  } as QualityCheck
  return { ...p, steps: { ...p.steps, 2: { ...p.steps[2], qualityCheck: check as never } } }
}

function proposal(): Proposal {
  return makeProposal(
    [
      {
        op: 'add',
        collection: 'causes',
        tempId: 'new:1',
        fields: { groupId: 'tg1', parentId: 'ca4', text: 'Die Eltern arbeiten oft im Schichtdienst und sind nachmittags nicht da.', evidence: 'unsicher', notInfluenceable: true, why: 'Haben zwei Jugendliche erzählt.' },
      },
      { op: 'update', collection: 'causes', targetId: 'ca4', baseRev: 1, fields: { parentId: 'ca1' } },
      { op: 'remove', collection: 'consequences', targetId: 'co1', baseRev: 1 },
      { op: 'add', collection: 'consequences', tempId: 'new:2', fields: { groupId: 'tg3', parentId: '', text: 'Sie bleiben weg, sobald es voll wird.' } },
      { op: 'add', collection: 'problems', tempId: 'new:3', fields: { groupId: 'tg4', coreProblem: 'Nachbarinnen und Nachbarn erleben die Jugendlichen vor allem als laut.', why: 'Beschwerden bei der Hausverwaltung im Sommer.' } },
    ],
    { id: 'p1', summary: 'Eine tiefere Ursache, eine Folge für die Mädchen und ein Kernproblem für die Nachbarschaft.' },
  )
}

function withProposal(): Project {
  const p = step2Project()
  const prop = proposal()
  const messages: StoredMessage[] = [
    { id: 'g1', at, role: 'user', content: [{ type: 'text', text: 'Bei den Mädchen fehlt noch was, und die Nachbarn beschweren sich oft.' }] },
    {
      id: 'g2',
      at,
      role: 'assistant',
      content: [
        { type: 'text', text: 'Ich habe den Baum ergänzt. Trifft es zu, dass die Eltern nachmittags oft arbeiten?' },
        { type: 'tool_use', id: prop.toolUseId, name: 'propose_changes', input: {} },
      ],
    },
  ]
  p.steps[2].proposals = [prop]
  p.steps[2].segments = [{ id: 's1', startedAt: at, messages }]
  return p
}

function Step2Screen({ start, check }: { start: () => Project; check?: boolean }) {
  const [project, setProject] = useState(start)
  const current = useRef(project)
  current.current = project
  const controls: CheckControls | undefined = check
    ? {
        runs: {},
        check: async () => {
          const next = checked(current.current)
          setProject(next)
          return next.steps[2].qualityCheck
        },
      }
    : undefined
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 2 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} check={controls} />
}

export const step2Screens: Record<string, { caption: string; render: () => ReactNode }> = {
  step2: { caption: 'Schritt 2: zwei Fokusgruppen, Ursachen mit Ebenen, weitere Zielgruppen', render: () => <Step2Screen start={step2Project} check /> },
  'step2-empty': { caption: 'Schritt 2: noch leer', render: () => <Step2Screen start={emptyStep2} /> },
  'step2-nofocus': { caption: 'Schritt 2: keine Fokusgruppe in Schritt 1', render: () => <Step2Screen start={noFocus} /> },
  'step2-hidden': { caption: 'Schritt 2: eine Gruppe ist keine Fokusgruppe mehr', render: () => <Step2Screen start={hidden} /> },
  'step2-blocked': { caption: 'Schritt 2: geprüft, zwei ⛔ (Warum fehlt)', render: () => <Step2Screen start={() => checked(step2Project())} check /> },
  'step2-proposal': { caption: 'Schritt 2: Vorschlag mit Gruppen, Ebenen und Entfernen mit Folgen darunter', render: () => <Step2Screen start={withProposal} /> },
}


