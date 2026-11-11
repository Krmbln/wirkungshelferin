import { useState, type ReactNode } from 'react'
import { APP_CHECKED } from '../ai/check'
import { rubricCriteria } from '../ai/tools'
import type { LooseBlock } from '../domain/block'
import { withAppJudged } from '../domain/check'
import { makeProject } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project, QualityCheck } from '../domain/schemas/project'
import { stepIds } from '../domain/types'
import { App } from '../ui/App'
import { allNodes } from '../ui/copy/model'
import { toHtml } from '../ui/copy/render'
import { step6Project } from './step6Screens'

// Copy output for the gallery (step 23, design §6.5): "Kopieren" on the Baustein heading,
// Home's "Ergebnis" section, the banner after the last confirm, and the copied document itself
// as Docs would get it. Made-up content (the "Schraubzeit" bike workshop).

const galleryNow = new Date('2026-11-10T15:00:00')
const at = '2026-11-10T14:00:00.000Z'

/** Every step confirmed but step 6 (in Arbeit): one step named in Home's line. */
function mostlyConfirmed(): Project {
  const p = step6Project()
  p.steps[0].block.profile = { ...p.steps[0].block.profile, name: 'Schraubzeit', organisation: 'Fahrradclub Nordstadt e. V.', location: 'Weidengrund-Siedlung' }
  for (const s of stepIds) if (s !== 6) p.steps[s].status = 'confirmed'
  return p
}

/** Steps 3–6 not confirmed: Home's line falls back to the general sentence. */
function manyOpen(): Project {
  const p = mostlyConfirmed()
  for (const s of [3, 4, 5] as const) p.steps[s].status = 'in_progress'
  return p
}

/** Step 6 checked (rows complete), ready to confirm: the last step's banner after "Bestätigen". */
function readyToConfirm(): Project {
  const p = mostlyConfirmed()
  for (const row of p.steps[6].block.planRows) row.why ||= 'Das Gespräch führt die Honorarkraft ohnehin.'
  const block = structuredClone(p.steps[6].block)
  const results: QualityCheck['results'] = rubricCriteria(6).map((c) => ({ criterion: c.id, result: 'ok', note: APP_CHECKED }))
  p.steps[6].qualityCheck = { at, source: 'app', block, results: withAppJudged(6, block as unknown as LooseBlock, results, p) } as never
  return p
}

function Live({ start, step }: { start: () => Project; step?: 4 | 6 }) {
  const [project, setProject] = useState(start)
  return (
    <App
      now={galleryNow}
      project={project}
      initialView={step === undefined ? { kind: 'home' } : { kind: 'step', step }}
      onBlockAction={(a) => setProject((p) => reducer(p, a))}
    />
  )
}

/** The exact clipboard HTML, shown with the browser's own styles (what a paste target starts from). */
function Preview({ project }: { project: Project }) {
  const html = toHtml(allNodes(project, galleryNow))
  const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  // Our own renderer's output: every text is escaped there (tests/unit/copy.test.ts).
  return <article className="copy-preview" dangerouslySetInnerHTML={{ __html: body }} />
}

/** Step 3 not confirmed, step 6 untouched: the status notes and "Noch nicht bearbeitet.". */
function mixed(): Project {
  const p = mostlyConfirmed()
  p.steps[3].status = 'in_progress'
  p.steps[6].block = { planRows: [] }
  p.steps[6].status = 'not_started'
  return p
}

export const copyScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  'copy-step': { caption: 'Kopieren: am Baustein (Schritt 4)', render: () => <Live start={mostlyConfirmed} step={4} /> },
  'copy-step-empty': { caption: 'Kopieren: leerer Baustein, kein Knopf', render: () => <Live start={() => makeProject()} step={4} /> },
  'copy-home': { caption: 'Alles kopieren: Übersicht, Abschnitt Ergebnis', render: () => <Live start={mostlyConfirmed} /> },
  'copy-home-many': { caption: 'Alles kopieren: vier Schritte nicht bestätigt', render: () => <Live start={manyOpen} /> },
  'copy-home-empty': { caption: 'Alles kopieren: noch nichts ausgefüllt', render: () => <Live start={() => makeProject()} /> },
  'copy-final': { caption: 'Alles kopieren: nach dem Bestätigen von Schritt 6', render: () => <Live start={readyToConfirm} step={6} /> },
  'copy-preview': { caption: 'Kopierter Text: ganzes Wirkungsmodell', render: () => <Preview project={mostlyConfirmed()} /> },
  'copy-preview-mixed': { caption: 'Kopierter Text: Schritt 3 nicht bestätigt, Schritt 6 leer', render: () => <Preview project={mixed()} /> },
}
