/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Production only: the dev server needs inline scripts (tech design §12).
// frame-ancestors is not honoured in a <meta> CSP, so it is left out.
export const CSP_DIRECTIVES: Record<string, string> = {
  // Deny by default: frames, workers, media and manifests fall back to 'none'.
  'default-src': "'none'",
  'script-src': "'self'",
  'style-src': "'self'",
  'font-src': "'self'",
  'img-src': "'self'",
  'connect-src': 'https://api.anthropic.com',
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
  // No script may write HTML into the page (innerHTML and friends); model output can't become markup.
  'require-trusted-types-for': "'script'",
  'trusted-types': "'none'",
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
  resolve: {
    alias: {
      // Its browser build decodes "&amp;" via element.innerHTML, which Trusted Types refuses (the
      // Markdown renderer would crash on any entity). The table build does the same without the DOM.
      'decode-named-character-reference': fileURLToPath(
        new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
      ),
    },
  },
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
      {
        // `npm run contract` only: real API calls, never in `check` or CI (implementation plan step 8).
        extends: true,
        test: {
          name: 'contract',
          environment: 'node',
          include: ['tests/contract/**/*.test.ts'],
          testTimeout: 300_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
