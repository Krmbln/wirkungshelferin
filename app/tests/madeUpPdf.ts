// A small made-up PDF, written by hand (no library): two pages of Helvetica text.
// Content is invented ("Schraubzeit", like the demo project). Long enough that a small
// max_tokens forces at least one continuation in the contract's PDF check.

export const PDF_FIRST_LINE = 'Sachbericht Schraubzeit - Testdokument'
export const PDF_LAST_LINE = 'ENDE DES TESTDOKUMENTS'
export const PDF_ROWS = 40

export function pdfLines(): string[][] {
  const rows = Array.from(
    { length: PDF_ROWS },
    (_, i) => `Nachmittag ${i + 1}: ${10 + ((i * 7) % 9)} Jugendliche, ${2 + (i % 5)} Raeder repariert, ${i % 3} Raeder ausgegeben.`,
  )
  return [
    [PDF_FIRST_LINE, '', 'Offene Fahrradwerkstatt im Nachbarschaftshaus Am Weidengrund.', 'Anwesenheit pro Nachmittag:', '', ...rows.slice(0, 22)],
    [...rows.slice(22), '', 'Die Zahlen sind Schaetzungen des Teams.', PDF_LAST_LINE],
  ]
}

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)

export function madeUpPdf(): Uint8Array {
  const pages = pdfLines()
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 3 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  const font = 3 + pages.length * 2
  pages.forEach((lines, i) => {
    const stream = `BT /F1 11 Tf 14 TL 56 790 Td ${lines.map((l) => `(${escape(l)}) '`).join(' ')} ET`
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[font] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

export const madeUpPdfBase64 = () => Buffer.from(madeUpPdf()).toString('base64')
