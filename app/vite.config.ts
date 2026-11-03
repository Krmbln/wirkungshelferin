/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Production only: the dev server needs inline scripts (tech design §12).
// frame-ancestors is not honoured in a <meta> CSP, so it is left out.
export const CSP_DIRECTIVES: Record<string, string> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self'",
  'font-src': "'self'",
  'img-src': "'self'",
  'connect-src': 'https://api.anthropic.com',
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'none'",
}

function cspMeta(): Plugin {
  const content = Object.entries(CSP_DIRECTIVES)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ')
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' },
    ],
  }
}

export default defineConfig({
  base: '/wirkungshelferin/',
  plugins: [react(), cspMeta()],
  server: {
    // The method guide lives outside app/ and is imported with ?raw.
    fs: { allow: [repoRoot] },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dist',
          environment: 'node',
          include: ['tests/dist/**/*.test.ts'],
        },
      },
    ],
  },
})
