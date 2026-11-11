import type { Copied } from './render'

// Writes a copy to the clipboard (design §6.5): HTML and plain text together; if Chrome refuses
// that, plain text alone (PRD F8's fallback); 'failed' only when both are refused.

export type CopyResult = 'rich' | 'plain' | 'failed'

/** The part of `navigator.clipboard` used here (tests pass a fake). */
export type ClipboardLike = Pick<Clipboard, 'write' | 'writeText'>

export async function writeClipboard(copied: Copied, clipboard: ClipboardLike | undefined = navigator.clipboard): Promise<CopyResult> {
  if (!clipboard) return 'failed'
  try {
    if (typeof ClipboardItem === 'undefined') throw new Error('no ClipboardItem')
    const item = new ClipboardItem({
      'text/html': new Blob([copied.html], { type: 'text/html' }),
      'text/plain': new Blob([copied.text], { type: 'text/plain' }),
    })
    await clipboard.write([item])
    return 'rich'
  } catch {
    try {
      await clipboard.writeText(copied.text)
      return 'plain'
    } catch {
      return 'failed'
    }
  }
}
