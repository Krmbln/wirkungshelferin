import ReactMarkdown, { type Components } from 'react-markdown'

// Claude's Markdown, rendered inert (tech design §12): raw HTML stays literal text (no
// rehype-raw), images show as text, and only https links work, in a new tab.

const safeUrl = (url: string) => (/^https:\/\//i.test(url) ? url : '')

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => <span>{alt ? `[Bild: ${alt}]` : '[Bild]'}</span>,
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
