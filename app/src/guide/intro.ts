import { guideFiles, stepGuide } from '.'

// The intro panel and the term tooltips come straight from the guide (design §6.2), so the
// panel says what the assistant was told. The guide's "Beispiel" is an instruction to the
// assistant (made from the person's project), not panel text, so the panel leaves it out.

export type StepIntro = { what: string; why: string; terms: string[] }

/** The panel shows plain text: emphasis marks from the guide go. */
const plain = (text: string) => text.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')

/** The "## 3. Intro-Panel" section of a step file: quoted paragraphs that start with a bold label. */
export function stepIntro(step: number): StepIntro {
  const { name, text } = stepGuide(step)
  const section = text.split(/^## /m).find((s) => s.startsWith('3. Intro-Panel'))
  if (!section) throw new Error(`${name} has no intro panel`)
  const quoted = section
    .split('\n')
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')
  const parts = new Map<string, string>()
  for (const paragraph of quoted.split(/\n\s*\n/)) {
    const match = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(paragraph.trim())
    if (match) parts.set(match[1].replace(/:$/, ''), plain(match[2].replace(/\s*\n\s*/g, ' ').trim()))
  }
  const what = parts.get('Worum geht es?')
  const why = parts.get('Warum?')
  const terms = parts.get('Begriffe')
  if (!what || !why || !terms) throw new Error(`${name}: intro panel needs "Worum geht es?", "Warum?" and "Begriffe"`)
  return { what, why, terms: terms.split('·').map((t) => t.trim()).filter(Boolean) }
}

export type GlossaryEntry = { term: string; plain: string; technical?: string }

/** The glossary table: "| **Begriff** (Fachwort: …) | Klartext |". */
export function glossary(): GlossaryEntry[] {
  return guideFiles['glossary.md'].split('\n').flatMap((line) => {
    const match = /^\|\s*\*\*(.+?)\*\*(.*?)\|(.+)\|\s*$/.exec(line)
    if (!match) return []
    const technical = /Fachwort:\s*([^)]+)\)/.exec(match[2])?.[1].trim()
    return [{ term: match[1].trim(), plain: plain(match[3].trim()), ...(technical && { technical }) }]
  })
}

const byTerm = new Map(glossary().map((e) => [e.term.toLowerCase(), e]))

/**
 * The glossary entries a term from the intro panel stands for. "direkte/indirekte Zielgruppe"
 * stands for two. Empty when the glossary lacks it (a guide test keeps that from shipping).
 */
export function termEntries(term: string): GlossaryEntry[] {
  const exact = byTerm.get(term.toLowerCase())
  if (exact) return [exact]
  const [first, ...rest] = term.split(' ')
  if (!first.includes('/')) return []
  const entries = first.split('/').map((word) => byTerm.get([word, ...rest].join(' ').toLowerCase()))
  return entries.every(Boolean) ? (entries as GlossaryEntry[]) : []
}
