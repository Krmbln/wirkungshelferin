// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = fileURLToPath(new URL('../../src', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  )

describe('Zod under the CSP', () => {
  it('only schemas/zod.ts imports zod directly, so jitless is set before any schema exists', () => {
    const direct = files(src).filter((f) => /from ['"]zod(\/[^'"]*)?['"]/.test(readFileSync(f, 'utf8')))
    expect(direct.map((f) => f.slice(src.length + 1))).toEqual(['domain/schemas/zod.ts'])
  })
})
