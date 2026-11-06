// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { stepIds } from '../../src/domain/types'
import { glossary, stepIntro, termEntries } from '../../src/guide/intro'

// The intro panel and term tooltips come from the guide (step 10). If a guide edit breaks the
// panel's shape or names a term the glossary lacks, this fails before it ships.

describe('intro panel from the guide', () => {
  it.each(stepIds)('step %s has "Worum geht es?", "Warum?" and terms, without the assistant’s example instruction', (step) => {
    const intro = stepIntro(step)
    expect(intro.what.length).toBeGreaterThan(40)
    expect(intro.why.length).toBeGreaterThan(20)
    expect(intro.terms.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(intro)).not.toMatch(/Anweisung an den Assistenten|\*\*/)
  })

  it.each(stepIds)('every term of step %s is in the glossary', (step) => {
    for (const term of stepIntro(step).terms) expect(termEntries(term), term).not.toEqual([])
  })

  it('step 1 reads as written in the guide', () => {
    const intro = stepIntro(1)
    expect(intro.what).toMatch(/^Wirkung passiert immer bei Menschen\. Jetzt klären wir:/)
    expect(intro.terms).toEqual(['Herausforderung', 'Zielgruppe', 'direkte/indirekte Zielgruppe', 'Fokusgruppe', 'Beteiligte'])
  })
})

describe('glossary', () => {
  it('reads every row with its plain text; "Fachwort" is kept apart, emphasis goes', () => {
    const entries = glossary()
    expect(entries.length).toBeGreaterThan(50)
    expect(entries.find((e) => e.term === 'Leistung')).toMatchObject({ technical: 'Output', plain: expect.stringMatching(/^Was das Projekt anbietet/) })
    expect(entries.find((e) => e.term === 'Erhebung')?.technical).toBeUndefined()
    expect(entries.find((e) => e.term === 'Offen')?.plain).toMatch(/Besser offen als geraten/)
  })

  it('finds terms regardless of case, and "a/b noun" as two entries', () => {
    expect(termEntries('externer Faktor').map((e) => e.term)).toEqual(['Externer Faktor'])
    expect(termEntries('direkte/indirekte Zielgruppe').map((e) => e.term)).toEqual(['Direkte Zielgruppe', 'Indirekte Zielgruppe'])
    expect(termEntries('Quatsch')).toEqual([])
  })
})
