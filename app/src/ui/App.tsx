import { guideFiles } from '../guide'

// Placeholder until the app frame exists (step 3).
export function App() {
  return (
    <main>
      <h1>Wirkungshelferin</h1>
      <p>Hier entsteht die Wirkungshelferin.</p>
      <p>Leitfaden geladen: {Object.keys(guideFiles).length} Dateien</p>
    </main>
  )
}
