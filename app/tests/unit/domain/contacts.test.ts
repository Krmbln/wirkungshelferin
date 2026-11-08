// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { prepareAct } from '../../../src/ai/chat'
import { PDF_SYSTEM } from '../../../src/ai/pdf'
import { operatingRules } from '../../../src/ai/rules'
import { scrubContacts } from '../../../src/domain/contacts'
import { makeProject } from '../../../src/domain/fixtures'

// Contact data out of sources (PO 2026-11-08, "as safe as possible, 80/20"). Made-up data only.

describe('scrubContacts', () => {
  it('replaces e-mail addresses, phone numbers and IBANs', () => {
    const text = [
      'Ansprechperson: Frau Beispiel, Tel. 0176 12 34 56 78, Fax 030/123456-7',
      'Mail: kontakt@werkstatt-beispiel.de oder a.b+c@mail.example.org',
      'Mobil +49 151 2345678 · Büro (030) 98 76 54 32',
      'IBAN DE89 3704 0044 0532 0130 00 oder DE89370400440532013000',
    ].join('\n')
    const { text: out, removed } = scrubContacts(text)
    expect(out).toBe(
      [
        'Ansprechperson: Frau Beispiel, Tel. [Telefon], Fax [Telefon]',
        'Mail: [E-Mail] oder [E-Mail]',
        'Mobil [Telefon] · Büro [Telefon]',
        'IBAN [Bankverbindung] oder [Bankverbindung]',
      ].join('\n'),
    )
    expect(removed).toBe(8)
  })

  it('leaves dates, amounts, years, postcodes, times, shares and counts alone', () => {
    const text =
      'Laufzeit 01.04.2026 bis 31.12.2027 (2026–2027, 2026-2027). Budget 100.000 € bzw. 200 000 €. 10829 Berlin. ' +
      'Training 15–18 Uhr, 09:00 bis 12:00. Koordination 55 %, 0,5 Stellen. Ziel: 50–60 Kinder, U13, Vereinsnummer 12536.'
    expect(scrubContacts(text)).toEqual({ text, removed: 0 })
  })
})

describe('speed', () => {
  it('stays fast on 150.000 characters of the worst shapes (no quadratic matching)', () => {
    for (const text of ['a'.repeat(150_000), '0 '.repeat(75_000), 'a.'.repeat(75_000) + '@', 'DE'.repeat(75_000)]) {
      const start = performance.now()
      scrubContacts(text)
      expect(performance.now() - start).toBeLessThan(500)
    }
  })
})

describe('where it applies', () => {
  const at = '2026-11-08T12:00:00.000Z'
  it('a paste and a PDF are scrubbed before they are stored and sent; the count is the stored text', () => {
    for (const kind of ['paste', 'pdf'] as const) {
      const prepared = prepareAct(makeProject(), 0, { kind, label: 'Antrag', text: 'Kontakt: info@beispiel.de, 0176 12345678.' }, { at })!
      const [source] = prepared.project.steps[0].block.sources as { text: string }[]
      expect(source.text).toBe('Kontakt: [E-Mail], [Telefon].')
      const sent = JSON.stringify(prepared.call.messages)
      expect(sent).not.toContain('info@beispiel.de')
      expect(sent).not.toContain('12345678')
      expect(prepared.project.steps[0].segments[0].messages.at(-1)!.act!.chars).toBe(source.text.length)
    }
  })

  it('the reading instruction asks for placeholders; the step 0 rules explain them', () => {
    for (const p of ['[Name]', '[Telefon]', '[E-Mail]', '[Adresse]', '[Unterschrift]', '[Bankverbindung]']) {
      expect(PDF_SYSTEM).toContain(p)
      expect(operatingRules(0, 'text')).toContain(p)
    }
  })
})
