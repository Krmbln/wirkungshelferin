import '../components/Button.css'
import { Screen } from '../screens/Screen'

// Shown when another page embeds the app in a frame. Pages can't send frame-ancestors,
// so the app refuses to load data inside a frame itself (no clickjacking on the key or the project).
export function FrameGate({ appUrl }: { appUrl: string }) {
  return (
    <Screen>
      <h1>Bitte öffne die Wirkungshelferin direkt</h1>
      <p className="screen__lead">
        Diese Seite ist in eine andere Seite eingebettet. Damit deine Daten geschützt bleiben, läuft die
        Wirkungshelferin nur in einem eigenen Tab.
      </p>
      <div className="screen__actions">
        {/* A link (it opens a new tab) that looks like the other blocking screens' one action. */}
        <a className="btn btn--secondary" href={appUrl} target="_blank" rel="noopener noreferrer">
          In einem eigenen Tab öffnen
        </a>
      </div>
    </Screen>
  )
}
