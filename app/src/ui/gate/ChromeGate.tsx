import { useState } from 'react'

// Unstyled for now; step 2 restyles it with the design tokens (design §6.4).
export function ChromeGate({ appUrl }: { appUrl: string }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(appUrl)
      setCopied(true)
    } catch {
      // Clipboard refused: the link is still visible and selectable.
    }
  }

  return (
    <main>
      <h1>Bitte öffne die Wirkungshelferin in Chrome</h1>
      <ol>
        <li>
          Kopiere diesen Link: <code>{appUrl}</code>{' '}
          <button type="button" onClick={copyLink}>
            {copied ? 'Kopiert' : 'Link kopieren'}
          </button>
        </li>
        <li>
          Öffne Google Chrome. Falls du Chrome noch nicht hast:{' '}
          <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
            Chrome herunterladen
          </a>
        </li>
        <li>Füge den Link oben in die Adresszeile ein und drücke Enter.</li>
      </ol>
    </main>
  )
}
