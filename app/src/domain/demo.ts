import { makeItem, makeProject } from './fixtures'
import type { Project } from './schemas/project'

// A made-up demo project (implementation plan step 4): step 0 confirmed, so steps 9–13 can
// work on step 1 with a realistic profile before step 0 exists. Organisation, place and
// funder are invented. Deliberately unlike the guide's examples and the real pilot case.

export function demoProject(): Project {
  return makeProject({
    steps: {
      0: {
        status: 'confirmed',
        block: {
          profile: makeItem(0, 'profile', {
            name: 'Schraubzeit – offene Fahrradwerkstatt für Jugendliche',
            organisation: 'Nachbarschaftshaus Am Weidengrund e. V.',
            projectBoundary: 'Die offene Werkstatt am Dienstag- und Donnerstagnachmittag; nicht die Ferienkurse.',
            location: 'Weidengrund-Siedlung (Großwohnsiedlung am Stadtrand)',
            participants: 'Jugendliche von 12 bis 17 Jahren aus der Siedlung, im Schnitt 15 pro Nachmittag',
            funder: 'Stiftung Stadtteil Morgen',
            activities: [
              'Offene Werkstatt: eigene Räder reparieren mit Anleitung',
              'Aufbereitung gespendeter Räder, die Jugendliche nach 20 Stunden Mitarbeit behalten',
              'Kleine Touren in die Umgebung',
            ],
            duration: '2026–2027',
            budgetRange: 'offen',
            statedGoals: [
              'Jugendliche werden mobiler und kommen auch in andere Stadtteile',
              'Jugendliche können ihr Rad selbst instand halten',
            ],
            otherOffers: ['Jugendclub im Einkaufszentrum (abends)', 'Sportverein mit Fußball und Boxen'],
            openQuestions: ['Erwartet die Stiftung Angaben über die Teilnahmezahlen hinaus?'],
          }),
          frame: makeItem(0, 'frame', {
            purpose: 'beides',
            audience: 'Stiftung Stadtteil Morgen und das Team',
            requiredFormat: 'Kurzer Sachbericht mit Teilnahmezahlen pro Halbjahr',
            existingData: ['Anwesenheitsliste pro Nachmittag', 'Liste der vergebenen Räder'],
          }),
          sources: [
            makeItem(0, 'sources', {
              origin: 'paste',
              label: 'Projektskizze (eingefügt)',
              text: 'Schraubzeit ist eine offene Fahrradwerkstatt im Nachbarschaftshaus …',
            }),
          ],
        },
      },
    },
  })
}
