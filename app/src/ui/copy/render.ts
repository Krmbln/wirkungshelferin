// The copied document (design §6.5, PRD F8): a small tree written twice, as HTML that Google Docs
// and Word map to their own heading and list styles, and as plain text for everything else.
// Pure, no DOM.

/** A run of text; `strong` parts become <strong> (plain text keeps just the words). */
export type Inline = (string | { strong: string })[]

export type ListItem = { text: Inline; children?: ListItem[] }

export type Node =
  | { kind: 'h'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'p'; text: Inline }
  | { kind: 'list'; items: ListItem[] }

export type Copied = { html: string; text: string }

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inlineHtml = (text: Inline) => text.map((part) => (typeof part === 'string' ? escape(part) : `<strong>${escape(part.strong)}</strong>`)).join('')
const inlineText = (text: Inline) => text.map((part) => (typeof part === 'string' ? part : part.strong)).join('')

const listHtml = (items: ListItem[]): string =>
  `<ul>${items.map((item) => `<li>${inlineHtml(item.text)}${item.children?.length ? listHtml(item.children) : ''}</li>`).join('')}</ul>`

const listText = (items: ListItem[], depth = 0): string[] =>
  items.flatMap((item) => [`${'  '.repeat(depth)}- ${inlineText(item.text)}`, ...(item.children?.length ? listText(item.children, depth + 1) : [])])

export function toHtml(nodes: Node[]): string {
  const body = nodes
    .map((node) => {
      if (node.kind === 'h') return `<h${node.level}>${escape(node.text)}</h${node.level}>`
      if (node.kind === 'p') return `<p>${inlineHtml(node.text)}</p>`
      return listHtml(node.items)
    })
    .join('\n')
  // A whole document with its charset, so umlauts and „…“ survive every paste target (UI/UX M12).
  return `<html><head><meta charset="utf-8"></head><body>\n${body}\n</body></html>`
}

const UNDERLINE: Partial<Record<number, string>> = { 1: '=', 2: '-' }

/** Headings on their own lines (h1 and h2 underlined), a blank line between blocks, lists as "- " indented 2 per level. */
export function toText(nodes: Node[]): string {
  return nodes
    .map((node) => {
      if (node.kind === 'h') {
        const mark = UNDERLINE[node.level]
        return mark ? `${node.text}\n${mark.repeat(node.text.length)}` : node.text
      }
      if (node.kind === 'p') return inlineText(node.text)
      return listText(node.items).join('\n')
    })
    .join('\n\n')
}

export const render = (nodes: Node[]): Copied => ({ html: toHtml(nodes), text: toText(nodes) })
