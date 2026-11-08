import { useRef, useState, type ReactNode } from 'react'
import { rubricCriteria } from '../ai/tools'
import { makeItem } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, QualityCheck } from '../domain/schemas/project'
import { App } from '../ui/App'
import type { CheckControls, CheckRun } from '../ui/check/useCheckRunner'
import { filled } from './blockScreens'

// The quality gate for the gallery (step 13). Made-up content (the "Schraubzeit" bike workshop
// of demo.ts). Stateful like the Session: "Prüfen" answers after a moment with the screen's
// result, so the review can click through B, C, the question and the backup prompt.

const galleryNow = new Date('2026-11-04T12:00:00')
const at = '2026-11-04T11:50:00.000Z'

const notes: Record<string, string> = {
  1: 'Ein Satz, der einen Zustand bei den Jugendlichen beschreibt.',
  2: 'Unklar, ob Gelegenheitsbesucher dazugehören; offen ist auch, wer „regelmäßig“ kommt.',
  3: 'Jugendliche direkt, Eltern indirekt – passt.',
  4: 'Bei den Jugendlichen stehen nur Defizite; was können oder wollen sie?',
  5: 'Eine Fokusgruppe mit Auswahlgrund.',
  6: 'Geldgeber und Partner stehen bei den Beteiligten.',
  7: 'Jeder Eintrag hat Rolle und Erwartung.',
  8: 'Herausforderung und Gruppen haben ein Warum.',
}

function results(warn: string[]): QualityCheck['results'] {
  return rubricCriteria(1).map((c) => ({ criterion: c.id, result: warn.includes(c.id) ? 'warn' : 'ok', note: notes[c.id] }))
}

const checked = (p: Project, warn: string[]) =>
  reducer(p, { type: 'check/store', step: 1, check: { at, source: 'app', block: structuredClone(p.steps[1].block), results: results(warn) } })

/** filled() with every Why given: nothing blocks. */
function complete(): Project {
  const p = filled()
  p.steps[1].block.targetGroups[1] = { ...p.steps[1].block.targetGroups[1], why: 'Ohne ihr Okay kommen die Jüngeren nicht.' }
  return p
}

/** filled() with two missing Whys (the challenge's and the parents'). */
function twoMissing(): Project {
  const p = filled()
  p.steps[1].block.challenge = makeItem(1, 'challenge', { text: p.steps[1].block.challenge.text, why: '' })
  return p
}

function changed(): Project {
  const p = checked(twoMissing(), ['2', '4'])
  return reducer(p, { type: 'item/edit', step: 1, collection: 'challenge', id: 'challenge', fields: { why: 'Daran hängt alles Weitere.' } })
}

function CheckScreen({ start, warn = ['2', '4'], run, delay = 900, chatBusy = false }: { start: () => Project; warn?: string[]; run?: CheckRun; delay?: number; chatBusy?: boolean }) {
  const [project, setProject] = useState(start)
  const [running, setRunning] = useState(false)
  const current = useRef(project)
  current.current = project
  const check: CheckControls = {
    runs: run ? { 1: run } : running ? { 1: { kind: 'running' } } : {},
    check: async () => {
      if (running) return undefined
      setRunning(true)
      await new Promise((resolve) => setTimeout(resolve, delay))
      const next = checked(current.current, warn)
      current.current = next
      setProject(next)
      setRunning(false)
      return next.steps[1].qualityCheck
    },
  }
  return (
    <App
      now={galleryNow}
      project={project}
      initialView={{ kind: 'step', step: 1 }}
      onBlockAction={(a) => setProject((p) => reducer(p, a))}
      check={check}
      chat={chatBusy ? { runs: { 1: { kind: 'running', blocks: [] } }, send: () => {}, stop: () => {}, retry: () => {} } : undefined}
    />
  )
}

export const checkScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  'check-unchecked': { caption: 'Qualitätscheck A: noch nicht geprüft (ein Warum fehlt)', render: () => <CheckScreen start={filled} /> },
  'check-busy': { caption: 'Qualitätscheck: prüft …', render: () => <CheckScreen start={filled} run={{ kind: 'running' }} /> },
  'check-blocked': { caption: 'Qualitätscheck B: zwei ⛔, zwei ⚠, Rest erfüllt', render: () => <CheckScreen start={() => checked(twoMissing(), ['2', '4'])} /> },
  'check-ready': { caption: 'Qualitätscheck C: nur ⚠ offen', render: () => <CheckScreen start={() => checked(complete(), ['2', '4'])} /> },
  'check-ready-clean': { caption: 'Qualitätscheck C: alles erfüllt', render: () => <CheckScreen start={() => checked(complete(), [])} warn={[]} /> },
  'check-changed': { caption: 'Qualitätscheck A: geändert seit der Prüfung, ein ⛔ noch offen', render: () => <CheckScreen start={changed} /> },
  'check-confirmed': {
    caption: 'Qualitätscheck: bestätigt, zwei Punkte trotzdem bestätigt',
    render: () => <CheckScreen start={() => reducer(checked(complete(), ['2', '4']), { type: 'step/confirm', step: 1, at })} />,
  },
  'check-chat-busy': { caption: 'Qualitätscheck wartet, solange im Chat eine Antwort läuft', render: () => <CheckScreen start={filled} chatBusy /> },
  'check-failed': { caption: 'Qualitätscheck: Prüfung fehlgeschlagen (offline)', render: () => <CheckScreen start={filled} run={{ kind: 'failed', problem: 'offline' }} /> },
}
