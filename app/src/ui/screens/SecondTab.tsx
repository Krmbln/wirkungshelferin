import { useState } from 'react'
import { Button } from '../components/Button'
import { Screen } from './Screen'

type Props = {
  /** Tries to close the tab and says whether it worked. */
  closeTab?: () => Promise<boolean>
}

// Chrome only lets a script close tabs it opened itself, so closing can fail.
async function tryCloseTab(): Promise<boolean> {
  window.close()
  await new Promise((resolve) => setTimeout(resolve, 200))
  return window.closed
}

// Second tab (design §6.4): no data is loaded here, so the tabs can't overwrite each other.
export function SecondTab({ closeTab = tryCloseTab }: Props) {
  const [closeFailed, setCloseFailed] = useState(false)

  return (
    <Screen>
      <h1>Die Wirkungshelferin ist schon in einem anderen Tab offen</h1>
      <p className="screen__lead">
        Arbeite dort weiter. So können sich zwei Tabs nicht gegenseitig überschreiben. Wenn du den anderen Tab
        schließt, geht es hier weiter.
      </p>
      <div className="screen__actions">
        <Button variant="secondary" onClick={async () => setCloseFailed(!(await closeTab()))}>
          Diesen Tab schließen
        </Button>
        {closeFailed && (
          <p className="screen__hint">Chrome lässt diesen Tab nicht von hier aus schließen – drück Cmd+W.</p>
        )}
      </div>
    </Screen>
  )
}
