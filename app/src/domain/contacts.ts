// Contact data out of Lukas's sources (PO 2026-11-08, "as safe as possible, 80/20"): before a
// pasted or read text is stored and sent, the patterns a machine finds reliably become
// placeholders. Names can't be found this way; for PDFs the reading instruction removes them
// (ai/pdf.ts), and the step 0 rules tell Claude what the placeholders mean.

export const PLACEHOLDERS = { email: '[E-Mail]', phone: '[Telefon]', iban: '[Bankverbindung]' } as const

// Every match starts where a word starts and has a length cap, so a long text stays linear
// (150.000 × "a" took 36 s with a free start).
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,5}/g
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g
// A German or international number: starts with + or 0, digits with spaces, slashes, dashes or
// brackets between them. Dots and commas end it, so dates (01.04.2026) and amounts never match.
const PHONE = /(?<![\w.,])\(?(?:\+\d{1,3}|0)[\d ()/-]{0,30}\d/g

const digits = (s: string) => s.replace(/\D/g, '').length

/** The text with e-mail addresses, IBANs and phone numbers replaced, and how many were replaced. */
export function scrubContacts(text: string): { text: string; removed: number } {
  let removed = 0
  const swap = (placeholder: string) => () => {
    removed++
    return placeholder
  }
  const out = text
    .replace(EMAIL, swap(PLACEHOLDERS.email))
    .replace(IBAN, swap(PLACEHOLDERS.iban))
    .replace(PHONE, (match) => {
      // Short runs (0 Uhr, 030) aren't numbers anyone could call.
      if (digits(match) < 7 || digits(match) > 15) return match
      removed++
      return PLACEHOLDERS.phone
    })
  return { text: out, removed }
}
