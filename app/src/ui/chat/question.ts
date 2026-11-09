import type { Proposal } from '../../domain/schemas/project'

// The one question under a proposal card (design §6.2 "Step 18b"). Claude's text shouldn't
// repeat it; when it does, the copy at the text's end goes and the line below the card stays.

/** The question a message ends with: the last shown card's (several cards still ask one question). */
export function closingQuestion(shown: Proposal[]): string | undefined {
  return shown.at(-1)?.question?.trim() || undefined
}

/** Case, spaces, quotes, emphasis marks and end punctuation don't make a different question. */
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[„“”"‚‘’'«»*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s?!.:…]+$/, '')
    .trim()

/** Markup a sentence cut could break: links, emphasis, code. */
const MARKUP = /[[\]*_`]/

/**
 * The message's text blocks without a trailing copy of the question: the whole last paragraph
 * when it is the question, else only its last sentence (never inside a paragraph with markup).
 * A different question stays: nothing Claude wrote is hidden beyond the copy.
 */
export function withoutQuestion(texts: string[], question: string | undefined): string[] {
  const asked = question && normalise(question)
  const last = texts.at(-1)
  if (!asked || !last) return texts
  const paragraphs = last.trimEnd().split(/\n[ \t]*\n/)
  const tail = paragraphs.at(-1)!
  let kept: string | undefined
  if (normalise(tail) === asked) kept = paragraphs.slice(0, -1).join('\n\n')
  else if (!MARKUP.test(tail)) {
    const sentences = tail.split(/(?<=[.!?…])\s+/)
    if (sentences.length > 1 && normalise(sentences.at(-1)!) === asked) kept = [...paragraphs.slice(0, -1), sentences.slice(0, -1).join(' ')].join('\n\n')
  }
  if (kept === undefined) return texts
  return kept.trim() ? [...texts.slice(0, -1), kept.trimEnd()] : texts.slice(0, -1)
}
