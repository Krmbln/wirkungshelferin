import { createContext, useContext } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { StepId } from '../../domain/types'
import { Icon } from '../components/Icon'

// Claude's Markdown, rendered inert (tech design §12): raw HTML stays literal text (no
// rehype-raw), images show as text, and only https links work, in a new tab. One exception:
// "[Zu Schritt 2](#schritt-2)" for an earlier step becomes a button that opens it (guide 00 §7,
// design §6.2 "Step 17").

/** The step the chat belongs to and how to open another one; without it step links stay text. */
export const StepLinks = createContext<{ step: StepId; onOpen: (step: StepId) => void } | null>(null)

const STEP_LINK = /^#schritt-([0-6])$/

const safeUrl = (url: string) => (/^https:\/\//i.test(url) || STEP_LINK.test(url) ? url : '')

function Link({ href, children }: { href?: string; children?: React.ReactNode }) {
  const links = useContext(StepLinks)
  const step = href?.match(STEP_LINK)
  if (step) {
    const target = Number(step[1]) as StepId
    if (!links || target >= links.step) return <span>{children}</span>
    return (
      <button type="button" className="md__step" data-step-link={target} onClick={() => links.onOpen(target)}>
        {children}
        <Icon name="chevronRight" size={16} />
      </button>
    )
  }
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  )
}

const components: Components = {
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  img: ({ alt }) => <span>{alt ? `[Bild: ${alt}]` : '[Bild]'}</span>,
}

/** Inline Markdown only (links, emphasis, code) in one paragraph: the question under a card (step 18b). */
const INLINE = ['a', 'strong', 'em', 'code']

export function InlineMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <p className={className}>
      <ReactMarkdown urlTransform={safeUrl} components={components} allowedElements={INLINE} unwrapDisallowed>
        {children}
      </ReactMarkdown>
    </p>
  )
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown urlTransform={safeUrl} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
