import { useEffect, useRef, useState } from 'react'
import { Button, type ButtonVariant } from '../components/Button'
import { Icon } from '../components/Icon'
import { StatusIcon } from '../components/StatusIcon'
import { writeClipboard, type ClipboardLike, type CopyResult } from './clipboard'
import type { Copied } from './render'
import './CopyButton.css'

/** How long the label says "Kopiert" (design §7.7). */
export const COPIED_MS = 2000

type Props = {
  /** Builds the copy at click time, from the newest project. */
  build: () => Copied
  children: string
  variant?: ButtonVariant
  /** The accessible name when the visible label alone isn't enough ("Baustein kopieren: Schritt 3 · …"). */
  label?: string
  disabledReason?: string
  clipboard?: ClipboardLike
  'data-copy'?: string
}

const ANNOUNCE = 'Kopiert. Du kannst den Text jetzt in Google Docs oder Word einfügen.'
const PLAIN_ANNOUNCE = 'Ohne Formatierung kopiert. Du kannst den Text jetzt einfügen.'

// "Kopieren" / "Alles kopieren" (design §6.5): the label turns into "Kopiert" for 2 s at the same
// width, focus stays; a plain-text fallback says so under the button; ⛔ only when nothing worked.
export function CopyButton({ build, children, variant = 'text', label, disabledReason, clipboard, ...rest }: Props) {
  const [copied, setCopied] = useState(false)
  const [result, setResult] = useState<CopyResult>()
  const [announce, setAnnounce] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    const outcome = await writeClipboard(build(), clipboard ?? navigator.clipboard)
    setResult(outcome)
    clearTimeout(timer.current)
    if (outcome === 'failed') {
      setCopied(false)
      return setAnnounce('')
    }
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    // The same words again are not read again: a no-break space makes each copy a new message (UI/UX M11).
    const text = outcome === 'plain' ? PLAIN_ANNOUNCE : ANNOUNCE
    setAnnounce((a) => (a === text ? `${text}\u00A0` : text))
  }

  return (
    <span className="copy">
      <Button
        variant={variant}
        aria-label={label}
        disabledReason={disabledReason}
        icon={copied ? <Icon name="statusOk" size={16} /> : <Icon name="copy" size={16} />}
        data-copy={rest['data-copy']}
        data-copied={copied || undefined}
        onClick={copy}
      >
        {/* Both labels share one cell, so the width never changes (design §6.5). */}
        <span className="btn__labels">
          <span className={copied ? 'btn__label--off' : undefined} aria-hidden={copied || undefined}>
            {children}
          </span>
          <span className={copied ? undefined : 'btn__label--off'} aria-hidden={!copied || undefined}>
            Kopiert
          </span>
        </span>
      </Button>
      {result === 'plain' && <span className="copy__line">Ohne Formatierung kopiert – Überschriften musst du beim Einfügen vielleicht selbst setzen.</span>}
      {result === 'failed' && (
        <span className="copy__line copy__line--failed">
          <StatusIcon status="block" size={16} tooltip={false} />
          Kopieren hat nicht geklappt. Versuch es gleich noch einmal.
        </span>
      )}
      <span className="visually-hidden" role="status">
        {announce}
      </span>
    </span>
  )
}
