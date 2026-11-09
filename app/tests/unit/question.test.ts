// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { makeProposal } from '../../src/domain/fixtures'
import { closingQuestion, withoutQuestion } from '../../src/ui/chat/question'

// Step 18b: the one question under a card; a copy at the end of Claude's text goes (design §6.2).

const Q = 'Welche Gruppe nehmen wir als Nächstes?'

describe('closingQuestion', () => {
  it('is the last card’s question; none for a card stored before step 18b or with an empty one', () => {
    expect(closingQuestion([makeProposal([], { question: 'Erste?' }), makeProposal([], { question: ` ${Q} ` })])).toBe(Q)
    expect(closingQuestion([makeProposal([])])).toBeUndefined()
    expect(closingQuestion([makeProposal([], { question: '  ' })])).toBeUndefined()
    expect(closingQuestion([])).toBeUndefined()
  })
})

describe('withoutQuestion', () => {
  it('drops the last paragraph when it is the question (case, quotes, spaces, end punctuation ignored)', () => {
    expect(withoutQuestion(['Ich schlage zwei Ursachen vor.\n\n„Welche  Gruppe nehmen wir als nächstes?“'], Q)).toEqual(['Ich schlage zwei Ursachen vor.'])
    expect(withoutQuestion(['Ich schlage zwei Ursachen vor.\n\n**Welche Gruppe nehmen wir als Nächstes?**\n'], Q)).toEqual(['Ich schlage zwei Ursachen vor.'])
  })

  it('a text that is only the question leaves no empty block', () => {
    expect(withoutQuestion(['Vorab: zwei Ursachen.', Q], Q)).toEqual(['Vorab: zwei Ursachen.'])
    expect(withoutQuestion([Q], Q)).toEqual([])
  })

  it('drops only the last sentence when the paragraph ends with the question after a lead-in', () => {
    expect(withoutQuestion(['Erster Absatz.\n\nDas passt gut zu den Jugendlichen. Welche Gruppe nehmen wir als Nächstes?'], Q)).toEqual(['Erster Absatz.\n\nDas passt gut zu den Jugendlichen.'])
  })

  it('the gallery’s duplicate fixture hits the sentence branch; a colon lead-in is one sentence and stays', () => {
    const q = 'Passt das zu dem, was ihr an den Nachmittagen seht?'
    const tail = 'Die Annahme dazu markiere ich als kritisch: Wird die Gruppe zu groß, kommen nicht alle an die Werkbank.'
    expect(withoutQuestion([`Erst.\n\n${tail} ${q}`], q)).toEqual([`Erst.\n\n${tail}`])
    expect(withoutQuestion([`${tail} Sag mir ehrlich: ${q}`], q)).toEqual([`${tail} Sag mir ehrlich: ${q}`])
  })

  it('never cuts a sentence out of a paragraph with markup (a step link, emphasis)', () => {
    const linked = 'Dafür fehlt eine Ursache, [Zu Schritt 2](#schritt-2). Welche Gruppe nehmen wir als Nächstes?'
    expect(withoutQuestion([linked], Q)).toEqual([linked])
    const bold = 'Das ist **wichtig**. Welche Gruppe nehmen wir als Nächstes?'
    expect(withoutQuestion([bold], Q)).toEqual([bold])
  })

  it('a different question, or the question earlier in the text, stays: nothing else is hidden', () => {
    const other = ['Passt das so?']
    expect(withoutQuestion(other, Q)).toEqual(other)
    const earlier = [`${Q}\n\nUnd noch etwas zur Kette.`]
    expect(withoutQuestion(earlier, Q)).toEqual(earlier)
    const longer = ['Welche Gruppe nehmen wir als Nächstes, die Mädchen oder die Eltern?']
    expect(withoutQuestion(longer, Q)).toEqual(longer)
  })

  it('no question, no text: unchanged', () => {
    expect(withoutQuestion(['Text.'], undefined)).toEqual(['Text.'])
    expect(withoutQuestion([], Q)).toEqual([])
  })
})
