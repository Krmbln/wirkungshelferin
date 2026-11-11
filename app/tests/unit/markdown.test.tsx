import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InlineMarkdown, Markdown } from '../../src/ui/chat/Markdown'

// Step 24: a message the renderer can't handle (the entity decoder under Trusted Types was one)
// shows as plain text; the rest of the page stays. The renderer is made to throw on "KAPUTT".
vi.mock('react-markdown', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-markdown')>()
  return {
    ...real,
    default: (props: { children: string }) => {
      if (props.children.includes('KAPUTT')) throw new Error('renderer failed')
      return real.default(props as never)
    },
  }
})

describe('Markdown fallback', () => {
  it('a message that fails to render shows as plain text; its neighbours still render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <>
        <Markdown>{'**Fett** davor'}</Markdown>
        <Markdown>{'KAPUTT **mit** Zeile\nzwei'}</Markdown>
        <InlineMarkdown>{'KAPUTT und Frage?'}</InlineMarkdown>
      </>,
    )
    expect(screen.getByText('Fett').tagName).toBe('STRONG')
    const plain = screen.getByText((_, el) => el?.className === 'md__plain' && el.textContent === 'KAPUTT **mit** Zeile\nzwei')
    expect(plain).toBeTruthy()
    expect(screen.getByText('KAPUTT und Frage?').className).toBe('md__plain')
  })
})
