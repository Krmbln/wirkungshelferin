import { describe, expect, it } from 'vitest'
import { makeItem, makeProject, makeProposal } from '../../src/domain/fixtures'
import { projectSchema, type Project } from '../../src/domain/schemas/project'
import { step6Project } from '../../src/gallery/step6Screens'
import { allNodes, BROKEN, copyAll, copyStep, projectHasContent, stepHasContent, stepNodes, unconfirmedLine, UNTOUCHED } from '../../src/ui/copy/model'
import { toHtml, toText, type Node } from '../../src/ui/copy/render'

// Copy output (implementation plan step 23, PRD F8, design §6.5): the order, escaping, broken
// references, status notes, what is left out, and the plain-text form.

const NOW = new Date('2026-11-10T12:00:00')
const headings = (nodes: Node[]) => nodes.flatMap((n) => (n.kind === 'h' ? [`h${n.level} ${n.text}`] : []))
const texts = (nodes: Node[]) => toText(nodes)

/** The gallery's full made-up project (steps 0–6 filled, step 6 in Arbeit, one broken reference in steps 3, 4 and 6). */
const full = () => step6Project()

describe('order (PRD F8)', () => {
  it('"Alles kopieren" follows the PRD order on a full project', () => {
    expect(headings(allNodes(full(), NOW))).toEqual([
      'h1 Wirkungsmodell',
      'h2 Projekt und Messrahmen',
      // The fixture's profile is empty in a confirmed step 0: left out, never "nicht bearbeitet".
      'h3 Messrahmen',
      'h2 Herausforderung, Zielgruppen und Beteiligte',
      'h3 Zielgruppen',
      'h3 Beteiligte',
      'h2 Fokusgruppe: Jugendliche 12–17 aus der Siedlung',
      'h3 Problem',
      'h4 Ursachen',
      'h4 Folgen',
      'h3 Wirkungsziele',
      'h4 Stufe 6 · Lebenslage',
      'h4 Stufe 5 · Handeln',
      'h4 Stufe 4 · Wissen, Einstellung, Fähigkeiten',
      'h3 Wirkungslogik',
      'h4 Leistungen',
      'h4 Verbindungen',
      'h2 Fokusgruppe: Mädchen 11–14 aus der Siedlung',
      'h3 Problem',
      'h4 Ursachen',
      'h3 Wirkungsziele',
      'h4 Stufe 6 · Lebenslage',
      'h4 Stufe 5 · Handeln',
      'h3 Wirkungslogik',
      'h4 Leistungen',
      'h4 Verbindungen',
      'h2 Weitere Zielgruppen',
      'h3 Eltern der Jugendlichen',
      'h2 Für das ganze Projekt',
      'h3 Stufe 7 · Beitrag zur Gesellschaft',
      'h3 Ressourcen',
      'h3 Aktivitäten',
      'h3 Umfeld und Nebenwirkungen',
      'h2 Messfokus',
      'h3 Lernfragen',
      'h3 Zurückgestellte Kandidaten',
      'h2 Pflichtangaben der Geldgeberin',
      'h2 Indikatoren',
      'h3 Zu Frage 1: Bleiben die Ehrenamtlichen das ganze Jahr dabei – auch im Winter?',
      'h3 Zu Frage 2: Reparieren die Stammgäste ihr Rad wirklich selbst?',
      'h2 Datenerhebungsplan',
      'h3 Planzeile 1',
      'h3 Planzeile 2',
      'h3 Planzeile 3',
      'h3 Planzeile 4',
    ])
  })

  it('heading levels never skip one (Docs outline, Word navigation)', () => {
    for (const nodes of [allNodes(full(), NOW), ...([0, 1, 2, 3, 4, 5, 6] as const).map((s) => stepNodes(full(), s))]) {
      let level = 0
      for (const n of nodes) {
        if (n.kind !== 'h') continue
        expect(n.level).toBeLessThanOrEqual(level + 1)
        level = n.level
      }
    }
  })

  it('names the project and the date', () => {
    const p = full()
    p.steps[0].block.profile.name = 'Schraubzeit'
    expect(texts(allNodes(p, NOW))).toMatch(/^Wirkungsmodell: Schraubzeit\n=+\n\nStand: 10\.11\.2026 · erstellt mit der Wirkungshelferin/)
    p.steps[0].block.profile.name = 'offen'
    expect(headings(allNodes(p, NOW))[0]).toBe('h1 Wirkungsmodell')
  })

  it('per-block copy: the step heading, then the block in its own order', () => {
    expect(headings(stepNodes(full(), 4))).toEqual([
      'h1 Schritt 4 · Wirkungslogik',
      'h2 Ressourcen',
      'h2 Aktivitäten',
      'h2 Fokusgruppe: Jugendliche 12–17 aus der Siedlung',
      'h3 Leistungen',
      'h3 Verbindungen',
      'h2 Fokusgruppe: Mädchen 11–14 aus der Siedlung',
      'h3 Leistungen',
      'h3 Verbindungen',
      'h2 Umfeld und Nebenwirkungen',
    ])
    expect(texts(stepNodes(full(), 2))).toContain('Fokusgruppe: Jugendliche 12–17 aus der Siedlung\n-----')
  })
})

describe('content', () => {
  it('escapes item text in the HTML, keeps it literal in plain text', () => {
    const p = full()
    p.steps[1].block.stakeholders[0].role = 'Eltern <b>&"Freunde"'
    const { html, text } = copyAll(p, NOW)
    expect(html).toContain('Eltern &lt;b&gt;&amp;&quot;Freunde&quot;')
    expect(html).not.toContain('<b>')
    expect(text).toContain('Eltern <b>&"Freunde"')
    // Markdown typed into a field arrives as the characters.
    p.steps[1].block.stakeholders[0].role = '**fett** [Link](https://x.de)'
    expect(copyStep(p, 1).html).toContain('**fett** [Link](https://x.de)')
  })

  it('prints references as the referenced text, broken ones as ⚠︎ Verweis fehlt', () => {
    const text = copyAll(full(), NOW).text
    expect(text).toContain('Löst auf: „Reparaturen im Fahrradladen sind für die Familien zu teuer.“, „Kaum Erwachsene in ihrem Umfeld zeigen ihnen handwerkliche Dinge.“')
    // Step 3: a deleted cause; step 4: a deleted link end; step 6: a deleted mandatory figure.
    expect(text).toContain(`Löst auf: „Werkstätten gelten in vielen Familien als Ort für Jungen.“, ${BROKEN}`)
    expect(text).toContain(`Stufe 2 „Sechs bis acht Mädchen kommen zu den Nachmittagen.“ → ${BROKEN}`)
    expect(text).toContain(`Für: Pflichtangabe „Anzahl reparierter Räder“, ${BROKEN}`)
    expect(BROKEN).toBe('⚠︎ Verweis fehlt')
    expect(copyAll(full(), NOW).html).toContain(BROKEN)
  })

  it('every "Label:" is bold in the HTML, like Warum', () => {
    const { html } = copyAll(full(), NOW)
    for (const label of ['Zeitrahmen', 'Löst auf', 'Weil', 'Annahme', 'Evidenzbasis', 'Grund', 'Prüft', 'Soll-Wert', 'Für', 'Datenquelle', 'Warum', 'Pflichtangaben']) {
      expect(html).toMatch(new RegExp(`<strong>${label}: ?</strong>`))
    }
  })

  it('a question whose goal was deleted prints ⚠︎ Verweis fehlt in "Prüft"', () => {
    const p = full()
    p.steps[5].block.focusQuestions[1].goalIds = ['go99']
    expect(copyStep(p, 5).text).toContain(`Prüft: ${BROKEN}`)
  })

  it('never prints an internal id', () => {
    const { text } = copyAll(full(), NOW)
    expect(text).not.toMatch(/\b(tg|pb|ca|co|go|na|rs|ac|ou|li|ef|se|fq|dc|in|mf|pr|src)\d+\b/)
  })

  it('uses the UI words for values and leaves empty fields out', () => {
    const p = full()
    p.steps[0].block.frame.purpose = 'beides'
    p.steps[0].block.profile.location = 'offen'
    const text = copyAll(p, NOW).text
    expect(text).toContain('- Wofür?: beides')
    expect(text).toContain('- Ort: offen')
    expect(text).toContain('(direkt · Fokusgruppe · Größe: etwa 15 pro Nachmittag)')
    expect(text).toContain('(Evidenzbasis: Forschung/andere Projekte · nicht beeinflussbar)')
    expect(text).toContain('Grund: kritische Annahme, eigenes Lernen')
    expect(text).toContain('Stufe 5 · Handeln')
    expect(text).toContain('- Wer erhebt: Teamleitung')
    expect(text).not.toMatch(/: \n|: $/m)
    expect(text).not.toMatch(/\bleer\b/)
  })

  it('leaves out hidden items, sources and open proposals', () => {
    const p = full()
    // A cause of a non-focus group is hidden (design §6.2); its core problem stays.
    p.steps[2].block.causes.push(makeItem(2, 'causes', { groupId: 'tg2', parentId: '', text: 'Versteckte Ursache der Eltern', evidence: 'unsicher', notInfluenceable: false }, { id: 'ca10' }))
    p.steps[0].block.sources = [makeItem(0, 'sources', { origin: 'paste', label: 'Antrag', text: 'Geheimer Antragstext', at: '2026-11-01T10:00:00.000Z' }, { id: 'src1' })]
    p.steps[1].proposals = [makeProposal([{ op: 'add', collection: 'stakeholders', tempId: 'new:1', fields: { role: 'Vorgeschlagene Rolle', expectations: [] } }])]
    p.idCounters = { ...p.idCounters, ca: 10, src: 1 }
    const text = copyAll(projectSchema.parse(p), NOW).text
    expect(text).toContain('Kernproblem: Eltern wissen wenig darüber')
    expect(text).not.toContain('Versteckte Ursache')
    expect(text).not.toContain('Geheimer Antragstext')
    expect(text).not.toContain('Antrag')
    expect(text).not.toContain('Vorgeschlagene Rolle')
  })

  it('a goal resolves causes of its own group only (a cause of another group reads as broken)', () => {
    const p = full()
    p.steps[2].block.causes.push(makeItem(2, 'causes', { groupId: 'tg1', parentId: '', text: 'Ursache der anderen Gruppe', evidence: 'unsicher', notInfluenceable: false }, { id: 'ca10' }))
    const girls = p.steps[3].block.goals.find((g) => g.groupId === 'tg3')!
    girls.causeIds = ['ca10']
    p.idCounters = { ...p.idCounters, ca: 10 }
    expect(copyStep(p, 3).text).toContain(`Löst auf: ${BROKEN}`)
  })

  it('keeps items of a vanished group under "Ohne Zielgruppe"', () => {
    const p = full()
    p.steps[2].block.problems.push(makeItem(2, 'problems', { groupId: 'tg9', coreProblem: 'Problem einer gelöschten Gruppe' }, { id: 'pb9' }))
    p.idCounters = { ...p.idCounters, pb: 9 }
    const nodes = allNodes(p, NOW)
    expect(headings(nodes)).toContain('h3 Ohne Zielgruppe')
    expect(texts(nodes)).toContain('Problem einer gelöschten Gruppe')
  })
})

describe('status notes', () => {
  it('marks every heading whose content comes from an unconfirmed step', () => {
    const p = full()
    p.steps[3].status = 'in_progress'
    const text = copyAll(p, NOW).text
    // Once per focus group's Wirkungsziele, once for Stufe 7, once for "Weitere Zielgruppen" (steps 2 + 3) per group with content.
    expect(text).toContain('Wirkungsziele\n\n(noch nicht bestätigt)')
    expect(text).toContain('Stufe 7 · Beitrag zur Gesellschaft\n\n(noch nicht bestätigt)')
    expect(text).toContain('Eltern der Jugendlichen\n\n(noch nicht bestätigt)')
    expect(text.match(/\(noch nicht bestätigt\)/g)).toHaveLength(2 + 1 + 1 + 1)
    expect(text).not.toContain('Problem\n\n(noch nicht bestätigt)')
  })

  it('says "vielleicht veraltet" for an outdated step; unconfirmed wins in a mixed section', () => {
    const p = full()
    p.steps[2].status = 'maybe_outdated'
    let text = copyAll(p, NOW).text
    expect(text).toContain('Problem\n\n(vielleicht veraltet)')
    expect(text).toContain('Eltern der Jugendlichen\n\n(vielleicht veraltet)')
    p.steps[3].status = 'in_progress'
    text = copyAll(p, NOW).text
    expect(text).toContain('Eltern der Jugendlichen\n\n(noch nicht bestätigt)')
  })

  it('an untouched step reads "Noch nicht bearbeitet." under each of its headings', () => {
    const p = full()
    p.steps[6].block = { planRows: [] }
    p.steps[6].status = 'not_started'
    expect(copyAll(p, NOW).text).toContain(`Datenerhebungsplan\n------------------\n\n${UNTOUCHED}`)
    expect(texts(stepNodes(p, 6))).toBe(`Schritt 6 · Datenerhebungsplan\n==============================\n\n${UNTOUCHED}`)
    const fresh = makeProject()
    const all = copyAll(fresh, NOW).text
    expect(all.match(new RegExp(UNTOUCHED.replace('.', '\\.'), 'g'))!.length).toBeGreaterThan(5)
    expect(all).not.toContain('(noch nicht bestätigt)')
  })

  it('an empty part of a step that was worked on is left out, not called "nicht bearbeitet"', () => {
    const p = full()
    p.steps[1].block.stakeholders = []
    const text = copyAll(p, NOW).text
    expect(text).not.toMatch(/^Beteiligte$/m)
    // The non-focus group without core problem or goals has no heading of its own.
    expect(text).not.toMatch(/^Nachbarinnen und Nachbarn$/m)
    expect(texts(stepNodes(p, 1))).not.toMatch(/^Beteiligte$/m)
    expect(text).not.toContain(UNTOUCHED)
  })

  it('per-block copy carries the step status once, under the step heading', () => {
    const p = full()
    expect(texts(stepNodes(p, 6))).toMatch(/^Schritt 6 · Datenerhebungsplan\n=+\n\n\(noch nicht bestätigt\)\n\nPlanzeile 1/)
    expect(texts(stepNodes(p, 4))).not.toContain('(noch nicht')
  })
})

describe('confirmed despite ⚠ (PRD F8)', () => {
  const withWarning = (status: 'confirmed' | 'in_progress' = 'confirmed'): Project => {
    const p = full()
    const s = p.steps[4]
    s.status = status
    s.confirmed = { at: '2026-11-04T11:40:00.000Z', block: structuredClone(s.block) as never, basis: {} }
    s.qualityCheck = { at: '2026-11-04T11:40:00.000Z', source: 'app', block: structuredClone(s.block) as never, results: [{ criterion: '6', result: 'warn', note: 'Bei den Mädchen ist die Kette dünn.' }, { criterion: '2', result: 'ok', note: 'Passt.' }] }
    s.confirmedWarnings = ['6']
    return p
  }

  it('"Alles kopieren" lists them last, named by section, never by step number', () => {
    const nodes = allNodes(withWarning(), NOW)
    expect(headings(nodes).at(-1)).toBe('h2 Bewusst offen gelassene Punkte')
    const text = texts(nodes)
    expect(text).toMatch(/Bewusst offen gelassene Punkte\n-+\n\nDie Prüfung hat hier etwas angemerkt; bestätigt wurde trotzdem\.\n\n- Wirkungslogik · .+: Bei den Mädchen ist die Kette dünn\.$/)
    expect(text).not.toContain('Passt.')
    expect(text).not.toMatch(/Schritt \d/)
  })

  it('per-block copy lists only that step, without the section name', () => {
    const text = texts(stepNodes(withWarning(), 4))
    expect(text).toMatch(/Bewusst offen gelassene Punkte\n-+\n\nDie Prüfung hat .+\n\n- [^·\n]+: Bei den Mädchen ist die Kette dünn\.$/)
    expect(texts(stepNodes(withWarning(), 3))).not.toContain('Bewusst offen')
  })

  it('leaves them out once the step is edited again', () => {
    expect(texts(allNodes(withWarning('in_progress'), NOW))).not.toContain('Bewusst offen')
  })
})

describe('emptiness (button states)', () => {
  it('a fresh project has nothing to copy; step 0 with sources only neither', () => {
    const p = makeProject()
    expect(projectHasContent(p)).toBe(false)
    p.steps[0].block.sources = [makeItem(0, 'sources', { origin: 'paste', label: 'Antrag', text: 'Text', at: '2026-11-01T10:00:00.000Z' }, { id: 'src1' })]
    expect(stepHasContent(p, 0)).toBe(false)
    p.steps[0].block.profile.location = 'Nordstadt'
    expect(stepHasContent(p, 0)).toBe(true)
    expect(projectHasContent(p)).toBe(true)
  })

  it('a step with only an empty row added by hand has nothing to copy', () => {
    const p = makeProject()
    p.steps[4].block.resources = [makeItem(4, 'resources', { text: '' }, { id: 'rs1' })]
    expect(stepHasContent(p, 4)).toBe(false)
    expect(([0, 1, 2, 3, 4, 5, 6] as const).every((s) => stepHasContent(full(), s))).toBe(true)
  })
})

describe('Home line under "Alles kopieren"', () => {
  it('names up to three steps, outdated ones apart; four or more in general', () => {
    const p = full()
    for (const s of [0, 1, 2, 3, 4, 5, 6] as const) p.steps[s].status = 'confirmed'
    expect(unconfirmedLine(p)).toBeUndefined()
    p.steps[6].status = 'in_progress'
    expect(unconfirmedLine(p)).toBe('Noch nicht bestätigt: Schritt 6 – er wird so kopiert, wie er gerade ist.')
    p.steps[4].status = 'in_progress'
    expect(unconfirmedLine(p)).toBe('Noch nicht bestätigt: Schritt 4 und 6 – sie werden so kopiert, wie sie gerade sind.')
    p.steps[5].status = 'maybe_outdated'
    expect(unconfirmedLine(p)).toBe('Noch nicht bestätigt: Schritt 4 und 6. Vielleicht veraltet: Schritt 5 – sie werden so kopiert, wie sie gerade sind.')
    p.steps[0].status = 'not_started'
    expect(unconfirmedLine(p)).toBe('Noch nicht alle Schritte sind bestätigt – sie werden so kopiert, wie sie gerade sind.')
  })
})

describe('render', () => {
  it('plain text: underlined h1/h2, blank lines between blocks, lists indented 2 per level', () => {
    const nodes: Node[] = [
      { kind: 'h', level: 1, text: 'Titel' },
      { kind: 'h', level: 2, text: 'Teil' },
      { kind: 'p', text: [{ strong: 'Warum: ' }, 'weil'] },
      { kind: 'h', level: 3, text: 'Unterteil' },
      { kind: 'list', items: [{ text: ['a'], children: [{ text: ['b'], children: [{ text: ['c'] }] }] }, { text: ['d'] }] },
    ]
    expect(toText(nodes)).toBe('Titel\n=====\n\nTeil\n----\n\nWarum: weil\n\nUnterteil\n\n- a\n  - b\n    - c\n- d')
  })

  it('HTML: a whole document with its charset, headings, nested lists, strong', () => {
    const html = toHtml([
      { kind: 'h', level: 2, text: 'Teil' },
      { kind: 'list', items: [{ text: [{ strong: 'Frage 1: ' }, 'ä „x“'], children: [{ text: ['b'] }] }] },
    ])
    expect(html).toBe('<html><head><meta charset="utf-8"></head><body>\n<h2>Teil</h2>\n<ul><li><strong>Frage 1: </strong>ä „x“<ul><li>b</li></ul></li></ul>\n</body></html>')
  })
})
