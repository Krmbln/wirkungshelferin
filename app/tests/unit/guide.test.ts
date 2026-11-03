// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { guideFiles } from '../../src/guide'

const guideDir = new URL('../../../method-guide/', import.meta.url)

// Every guide file except the README belongs in the prompt.
const onDisk = readdirSync(guideDir)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .sort()

describe('guide bundle', () => {
  it('contains all 9 guide files', () => {
    expect(onDisk).toHaveLength(9)
    expect(Object.keys(guideFiles).sort()).toEqual(onDisk)
  })

  it.each(onDisk)('%s matches the file on disk', (file) => {
    const text = guideFiles[file as keyof typeof guideFiles]
    expect(text.length).toBeGreaterThan(500)
    expect(text).toBe(readFileSync(new URL(file, guideDir), 'utf8'))
  })
})
