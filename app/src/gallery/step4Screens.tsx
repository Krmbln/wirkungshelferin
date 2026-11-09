import { useRef, useState, type ReactNode } from 'react'
import { APP_CHECKED } from '../ai/check'
import type { LooseBlock } from '../domain/block'
import { withAppJudged } from '../domain/check'
import { makeItem, makeProposal } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, Proposal, QualityCheck, StoredMessage } from '../domain/schemas/project'
import type { Evidence } from '../domain/types'
import { App } from '../ui/App'
import type { CheckControls } from '../ui/check/useCheckRunner'
import { step3Project } from './step3Screens'

// Step 4 for the gallery (step 18): resources and activities, the chain of two focus groups
// (outputs, step 3's goals read-only, links with "weil", assumption, evidence, critical), a
// broken end, a level jump, external factors and side effects, the check and a proposal card.
// Made-up content (the "Schraubzeit" bike workshop), unlike the guide example and Lukas's case.

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:40:00.000Z'

const output = (id: string, groupId: string, level: 1 | 2 | 3, text: string) => makeItem(4, 'outputs', { groupId, level, text }, { id })
const link = (id: string, groupId: string, fromId: string, toId: string, because: string, assumption: string, evidence: Evidence, critical = false) =>
  makeItem(4, 'links', { groupId, fromId, toId, because, assumption, evidence, critical }, { id })

/** Step 3 confirmed; step 4 mostly filled: the youth chain complete, the girls' chain short and with a gap. */
export function step4Project(): Project {
  const p = step3Project()
  p.steps[3].status = 'confirmed'
  p.steps[3].confirmed = { at, block: structuredClone(p.steps[3].block) as never, basis: {} }
  p.steps[4].status = 'in_progress'
  p.steps[4].block = {
    resources: [
      makeItem(4, 'resources', { text: 'Zwei Ehrenamtliche aus dem Fahrradclub, je zwei Nachmittage pro Woche' }, { id: 'rs1' }),
      makeItem(4, 'resources', { text: 'Kellerraum der Wohnungsbaugesellschaft mit Werkbank' }, { id: 'rs2' }),
      makeItem(4, 'resources', { text: 'Gespendete Ersatzteile und Werkzeug' }, { id: 'rs3' }),
    ],
    activities: [
      makeItem(4, 'activities', { text: 'Offene Werkstatt dienstags und donnerstags, 15–18 Uhr', why: 'Damit die Jugendlichen einen festen Ort haben, an dem sie selbst schrauben.' }, { id: 'ac1' }),
      makeItem(4, 'activities', { text: 'Mädchen-Nachmittag einmal im Monat', why: 'Damit Mädchen ohne Jungen an der Werkbank ausprobieren können.' }, { id: 'ac2' }),
      makeItem(4, 'activities', { text: 'Elternbrief zu Beginn des Halbjahrs', why: '' }, { id: 'ac3' }),
    ],
    outputs: [
      output('ou1', 'tg1', 1, 'Die Werkstatt hat zweimal pro Woche drei Stunden offen.'),
      output('ou2', 'tg1', 2, 'Etwa 15 Jugendliche kommen mindestens zweimal im Monat.'),
      output('ou3', 'tg1', 3, 'Die Jugendlichen arbeiten an ihrem eigenen Rad und kommen wieder.'),
      output('ou4', 'tg3', 1, 'Zehn Mädchen-Nachmittage im Jahr.'),
      output('ou5', 'tg3', 2, 'Sechs bis acht Mädchen kommen zu den Nachmittagen.'),
    ],
    links: [
      link('li1', 'tg1', 'ac1', 'ou1', 'Die Ehrenamtlichen halten feste Zeiten, also ist sicher offen.', 'Die zwei Ehrenamtlichen bleiben das ganze Jahr dabei.', 'eigene_erfahrung', true),
      link('li2', 'tg1', 'ou1', 'ou2', 'Feste Zeiten sprechen sich in der Siedlung herum.', 'Die Jugendlichen erfahren von den Zeiten, auch ohne Aushang.', 'unsicher'),
      link('li3', 'tg1', 'ou2', 'ou3', 'Wer regelmäßig kommt, bekommt ein eigenes Projekt am Rad.', 'Es gibt genug Ersatzteile für alle Stammgäste.', 'eigene_daten'),
      link('li4', 'tg1', 'ou3', 'go3', 'Beim Schrauben am eigenen Rad üben sie Handgriffe immer wieder.', 'Die Ehrenamtlichen lassen sie selbst machen, statt es ihnen abzunehmen.', 'unsicher', true),
      link('li5', 'tg1', 'go3', 'go2', 'Wer flicken kann, lässt das Rad nicht mehr stehen.', 'Zu Hause gibt es Platz und etwas Werkzeug.', 'unsicher'),
      link('li6', 'tg1', 'go2', 'go1', 'Ein Rad, das fährt, macht unabhängig vom Bus.', 'Die Wege in der Umgebung sind mit dem Rad sicher genug.', 'forschung'),
      link('li7', 'tg3', 'ac2', 'ou4', 'Ein eigener Termin nur für Mädchen nimmt die Hemmschwelle.', 'Eine Ehrenamtliche hat einmal im Monat Zeit.', 'eigene_erfahrung'),
      // Jumps the filled Stufe 2 (a reading aid only) and lacks its assumption (⛔).
      link('li8', 'tg3', 'ou4', 'go4', 'Ohne Jungen trauen sich Mädchen an das Werkzeug.', '', 'unsicher'),
      // The end was deleted (⚠ "Verbindung unvollständig").
      link('li9', 'tg3', 'ou5', 'ou9', 'Wer kommt, bleibt, wenn es Spaß macht.', 'Die Gruppe versteht sich.', 'unsicher'),
    ],
    externalFactors: [
      makeItem(4, 'externalFactors', { groupId: '', text: 'Die Wohnungsbaugesellschaft kann den Kellerraum jederzeit kündigen.' }, { id: 'ef1' }),
      makeItem(4, 'externalFactors', { groupId: 'tg1', text: 'Ganztagsschule bis 16 Uhr lässt weniger Zeit am Nachmittag.' }, { id: 'ef2' }),
    ],
    sideEffects: [
      makeItem(4, 'sideEffects', { text: 'Mehr Lärm im Hof an den Werkstatttagen.', affectedGroup: 'Nachbarinnen und Nachbarn', direction: 'negative' }, { id: 'se1' }),
    ],
  }
  p.idCounters = { ...p.idCounters, rs: 3, ac: 3, ou: 9, li: 9, ef: 2, se: 1 }
  return p
}

function emptyStep4(): Project {
  const p = step4Project()
  p.steps[4].block = { resources: [], activities: [], outputs: [], links: [], externalFactors: [], sideEffects: [] }
  p.steps[4].status = 'not_started'
  return p
}

/** A third critical assumption for the youth: the live warning. */
function tooCritical(): Project {
  const p = step4Project()
  p.steps[4].block.links = p.steps[4].block.links.map((l) => (l.id === 'li3' ? { ...l, critical: true } : l))
  return p
}

function checked(p: Project): Project {
  const block = structuredClone(p.steps[4].block)
  const claude: QualityCheck['results'] = [
    { criterion: '1', result: 'warn', note: 'Bei den Mädchen fehlen Stufe 3 und der Weg zu Stufe 5.' },
    { criterion: '2', result: 'warn', note: 'Das Ziel „Mädchen arbeiten selbst am Werkzeug“ hat keinen Weg.' },
    { criterion: '3', result: 'warn', note: 'Der Elternbrief trägt zu keiner Verbindung bei.' },
    { criterion: '4', result: 'ok', note: 'Jedes „weil“ nennt einen Mechanismus.' },
    { criterion: '5', result: 'ok', note: 'Die Annahmen sagen, was wahr sein muss.' },
    { criterion: '6', result: 'ok', note: APP_CHECKED },
    { criterion: '7', result: 'ok', note: 'Kellerraum und Ganztag sind benannt.' },
    { criterion: '8', result: 'ok', note: 'Der Lärm im Hof ist bedacht.' },
    { criterion: '9', result: 'ok', note: 'Drei Verbindungen zu Zielen bei den Jugendlichen.' },
    { criterion: '10', result: 'warn', note: 'Die Kette der Mädchen wurde noch nicht vorwärts gelesen.' },
    { criterion: '11', result: 'ok', note: APP_CHECKED },
  ]
  const check: QualityCheck = { at, source: 'app', block, results: withAppJudged(4, block as unknown as LooseBlock, claude, p) } as QualityCheck
  return { ...p, steps: { ...p.steps, 4: { ...p.steps[4], qualityCheck: check as never } } }
}

function proposal(): Proposal {
  return makeProposal(
    [
      { op: 'add', collection: 'outputs', tempId: 'new:1', fields: { groupId: 'tg3', level: 3, text: 'Die Mädchen kommen wieder und bringen eine Freundin mit.' } },
      {
        op: 'add',
        collection: 'links',
        tempId: 'new:2',
        fields: { groupId: 'tg3', fromId: 'ou5', toId: 'new:1', because: 'Wer sich wohlfühlt, erzählt es weiter.', assumption: 'Die Gruppe bleibt klein genug, dass alle drankommen.', evidence: 'unsicher', critical: true },
      },
      { op: 'update', collection: 'links', targetId: 'li9', baseRev: 1, fields: { toId: 'go4' } },
      { op: 'add', collection: 'sideEffects', tempId: 'new:3', fields: { text: 'Jungen fühlen sich am Mädchen-Nachmittag ausgeschlossen.', affectedGroup: 'Jugendliche, die sonst kommen', direction: 'negative' } },
    ],
    { id: 'p1', summary: 'Stufe 3 für die Mädchen, die Lücke zur neuen Leistung und eine mögliche Nebenwirkung.' },
  )
}

function withProposal(): Project {
  const p = step4Project()
  const prop = proposal()
  const messages: StoredMessage[] = [
    { id: 'g1', at, role: 'user', content: [{ type: 'text', text: 'Bei den Mädchen fehlt doch noch, dass sie wiederkommen.' }] },
    {
      id: 'g2',
      at,
      role: 'assistant',
      content: [
        {
          type: 'text',
          text:
            'Stimmt – zwischen „Sechs bis acht Mädchen kommen“ und dem Ziel fehlt Stufe 3. Ich schlage vor: Die Mädchen kommen wieder und bringen eine Freundin mit.\n\n' +
            'Die Annahme dazu markiere ich als kritisch: Wird die Gruppe zu groß, kommen nicht alle an die Werkbank.\n\n' +
            'Passt das zu dem, was ihr an den Nachmittagen seht?',
        },
        { type: 'tool_use', id: prop.toolUseId, name: 'propose_changes', input: {} },
      ],
    },
  ]
  p.steps[4].proposals = [prop]
  p.steps[4].segments = [{ id: 's1', startedAt: at, messages }]
  return p
}

function Step4Screen({ start, check }: { start: () => Project; check?: boolean }) {
  const [project, setProject] = useState(start)
  const current = useRef(project)
  current.current = project
  const controls: CheckControls | undefined = check
    ? {
        runs: {},
        check: async () => {
          const next = checked(current.current)
          setProject(next)
          return next.steps[4].qualityCheck
        },
      }
    : undefined
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 4 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} check={controls} />
}

export const step4Screens: Record<string, { caption: string; render: () => ReactNode }> = {
  step4: { caption: 'Schritt 4: Ressourcen, Aktivitäten, Kette je Fokusgruppe, Umfeld und Nebenwirkungen', render: () => <Step4Screen start={step4Project} check /> },
  'step4-empty': { caption: 'Schritt 4: noch leer', render: () => <Step4Screen start={emptyStep4} /> },
  'step4-critical': { caption: 'Schritt 4: drei kritische Annahmen bei einer Gruppe', render: () => <Step4Screen start={tooCritical} /> },
  'step4-blocked': { caption: 'Schritt 4: geprüft, ⛔ und ⚠ (Annahme fehlt, Verbindung unvollständig)', render: () => <Step4Screen start={() => checked(step4Project())} check /> },
  'step4-proposal': { caption: 'Schritt 4: Vorschlag mit neuer Leistung, Verbindung dorthin und Nebenwirkung', render: () => <Step4Screen start={withProposal} /> },
}
