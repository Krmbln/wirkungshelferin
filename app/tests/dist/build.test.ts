// Checks the production build in app/dist. Run `npm run build` first.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const dist = new URL('../../dist/', import.meta.url)
const guideDir = new URL('../../../method-guide/', import.meta.url)

let html = ''
let js = ''

beforeAll(() => {
  if (!existsSync(new URL('index.html', dist))) {
    throw new Error('app/dist/index.html fehlt – zuerst `npm run build` ausführen')
  }
  html = readFileSync(new URL('index.html', dist), 'utf8')
  const assets = new URL('assets/', dist)
  js = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(f, assets), 'utf8'))
    .join('\n')
})

function cspDirectives(): Map<string, string> {
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)
  expect(meta, 'CSP meta tag missing').not.toBeNull()
  // Vite writes the quotes as HTML entities; the browser decodes them.
  const content = meta![1].replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&')
  return new Map(
    content
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/)
        return [name, values.join(' ')] as const
      }),
  )
}

describe('CSP in the built index.html', () => {
  it('has the expected directives', () => {
    expect(Object.fromEntries(cspDirectives())).toEqual({
      'default-src': "'none'",
      'script-src': "'self'",
      'style-src': "'self'",
      'font-src': "'self'",
      'img-src': "'self'",
      'connect-src': 'https://api.anthropic.com',
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'require-trusted-types-for': "'script'",
      'trusted-types': "'none'",
    })
  })

  it('names no directive a <meta> CSP ignores', () => {
    // frame-ancestors, sandbox and report-uri only work as HTTP headers, which Pages can't send.
    const csp = cspDirectives()
    for (const name of ['frame-ancestors', 'sandbox', 'report-uri', 'report-to']) expect(csp.has(name)).toBe(false)
  })

  it('never allows inline or eval scripts', () => {
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/)
  })

  it('comes before the first script', () => {
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'))
  })

  it('writes HTML into the page nowhere but in React itself (Trusted Types would refuse it at runtime)', () => {
    // React's own two paths (dangerouslySetInnerHTML, a <script> element) never run in this app.
    // Any other sink is a library that would crash under the CSP, like the entity decoder did.
    const sinks = [...js.matchAll(/.{0,40}(?:innerHTML|outerHTML)\s*=.{0,25}/g)].map((m) => m[0])
    const react = (s: string) => s.includes('__html') || s.includes('innerHTML=`<script>')
    expect(sinks.filter((s) => !react(s))).toEqual([])
    expect(js).not.toMatch(/insertAdjacentHTML|document\.write\(|createContextualFragment|\bsrcdoc\b|new DOMParser/)
  })

  it('leaves no inline script in the page', () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inline).toEqual([])
  })
})

describe('guide in the built bundle', () => {
  const files = readdirSync(guideDir).filter((f) => f.endsWith('.md') && f !== 'README.md')

  it.each(files)('contains text from %s', (file) => {
    // A plain run of letters survives any string escaping in the bundle.
    const text = readFileSync(new URL(file, guideDir), 'utf8')
    const fragment = text.match(/[A-Za-z][A-Za-z ]{40,}/)?.[0]
    expect(fragment, `no plain text fragment in ${file}`).toBeTruthy()
    expect(js).toContain(fragment)
  })
})

describe('design system in the built bundle', () => {
  const assets = new URL('assets/', dist)

  it('ships both Source Sans 3 weights as self-hosted woff2', () => {
    const fonts = readdirSync(assets).filter((f) => f.endsWith('.woff2'))
    expect(fonts.some((f) => f.startsWith('SourceSans3-Regular'))).toBe(true)
    expect(fonts.some((f) => f.startsWith('SourceSans3-Semibold'))).toBe(true)
  })

  it('loads fonts from its own origin only', () => {
    const css = readdirSync(assets)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(new URL(f, assets), 'utf8'))
      .join('\n')
    expect(css).toContain('Source Sans 3')
    expect(css).not.toMatch(/url\(["']?(https?:)?\/\//)
  })

  it('leaves the dev-only state gallery out', () => {
    expect(js).not.toContain('Zustandsgalerie')
    expect(readdirSync(assets).some((f) => /gallery/i.test(f))).toBe(false)
  })
})
