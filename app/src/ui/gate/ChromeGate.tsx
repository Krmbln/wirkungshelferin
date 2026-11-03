import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import './ChromeGate.css'

// Blocking screen (design §6.4): centred, no app chrome around it.
export function ChromeGate({ appUrl }: { appUrl: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const linkRef = useRef<HTMLElement>(null)

  // "Kopiert" for 2 s (design §7.7).
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(appUrl)
      setCopyFailed(false)
      setCopied(true)
    } catch {
      // Clipboard refused: select the link so Cmd+C works, and say so (design §7.3).
      if (linkRef.current) window.getSelection()?.selectAllChildren(linkRef.current)
      setCopyFailed(true)
    }
  }

  return (
    <main className="gate">
      <h1>Bitte öffne die Wirkungshelferin in Chrome</h1>
      <p className="gate__lead">Die Wirkungshelferin funktioniert nur in Google Chrome. So geht’s:</p>
      <ol className="gate__steps">
        <li>
          <div className="gate__step">
            <span>Kopiere diesen Link:</span>
            <span className="gate__link">
              <code ref={linkRef}>{appUrl}</code>
              <Button variant="secondary" icon={<Icon name="copy" size={18} />} onClick={copyLink}>
                {copied ? 'Kopiert' : 'Link kopieren'}
              </Button>
            </span>
            {copyFailed && <span className="gate__hint">Kopieren ging nicht – der Link ist markiert, drück Cmd+C.</span>}
          </div>
        </li>
        <li>
          <span>
            Öffne Google Chrome. Falls du Chrome noch nicht hast:{' '}
            <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
              Chrome herunterladen
            </a>
          </span>
        </li>
        <li>
          <span>Füge den Link in die Adresszeile ein und drücke Enter.</span>
        </li>
      </ol>
    </main>
  )
}
