import { useState, type ReactNode } from 'react'
import { makeItem, makeProject } from '../domain/fixtures'
import { reducer } from '../domain/reducer'
import type { Project } from '../domain/schemas/project'
import { App } from '../ui/App'

// Block panel states for the gallery (step 11). Made-up content (the "Schraubzeit" bike
// workshop of demo.ts), unlike the guide example and Lukas's case. Stateful like the Session,
// so the review can click: edit, remove + undo, the dialog.

const galleryNow = new Date('2026-11-04T12:00:00')

export function filled(): Project {
  const p = makeProject({
    steps: {
      0: { status: 'confirmed' },
      1: {
        status: 'in_progress',
        block: {
          challenge: makeItem(1, 'challenge', {
            text: 'Jugendliche in der Weidengrund-Siedlung haben nachmittags kaum Orte, an denen sie selbst etwas schaffen, und kommen ohne eigenes Rad schlecht aus der Siedlung heraus.',
            why: 'Daran hängt alles Weitere: die Probleme der Gruppen und die Wirkung, zu der die Werkstatt beitragen will.',
          }),
          targetGroups: [
            makeItem(
              1,
              'targetGroups',
              {
                name: 'Jugendliche 12–17 aus der Siedlung',
                description: 'Kommen nach der Schule in die offene Werkstatt, viele ohne eigenes Rad. Sie wollen selbst schrauben und etwas vorzeigen können.',
                reach: 'direct',
                isFocus: true,
                sizeEstimate: 'etwa 15 pro Nachmittag',
                why: 'Bei ihnen will die Werkstatt ihre Hauptwirkung erzielen; sie kommen regelmäßig.',
              },
              { id: 'tg1' },
            ),
            makeItem(1, 'targetGroups', { name: 'Eltern der Jugendlichen', description: 'Erlauben das Kommen und holen die Räder mit ab.', reach: 'indirect' }, { id: 'tg2', rev: 2, editedByUser: true }),
          ],
          stakeholders: [
            makeItem(1, 'stakeholders', { role: 'Stiftung Stadtteil Morgen', expectations: ['Teilnahmezahlen pro Halbjahr', 'Kurzer Sachbericht'] }, { id: 'sh1' }),
            makeItem(1, 'stakeholders', { role: 'Ehrenamtliche Schrauber', expectations: ['Feste Zeiten', 'Werkzeug in gutem Zustand'] }, { id: 'sh2', rev: 3, editedByUser: true }),
          ],
        },
      },
    },
  })
  // Content in step 2 for the focus group, so removing it asks first.
  p.steps[2].block.problems = [makeItem(2, 'problems', { groupId: 'tg1', coreProblem: 'Ohne Rad kommen sie nicht weg' }, { id: 'pb1' })]
  p.steps[2].block.causes = [makeItem(2, 'causes', { groupId: 'tg1', text: 'Räder sind teuer und gehen oft kaputt' }, { id: 'ca1' })]
  p.idCounters = { ...p.idCounters, pb: 1, ca: 1 }
  return p
}

const empty = () => makeProject({ steps: { 0: { status: 'confirmed' } } })

function BlockScreen({ start }: { start: () => Project }) {
  const [project, setProject] = useState(start)
  return <App now={galleryNow} project={project} initialView={{ kind: 'step', step: 1 }} onBlockAction={(a) => setProject((p) => reducer(p, a))} />
}

export const blockScreens: Record<string, { caption: string; render: () => ReactNode }> = {
  'block-empty': { caption: 'Baustein Schritt 1: noch leer', render: () => <BlockScreen start={empty} /> },
  block: { caption: 'Baustein Schritt 1: ausgefüllt, teils von Hand geändert', render: () => <BlockScreen start={filled} /> },
}
