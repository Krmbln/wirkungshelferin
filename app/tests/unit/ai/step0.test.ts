// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MAX_PASTE, prepareAct, prepareTurn } from '../../../src/ai/chat'
import { parseCheck } from '../../../src/ai/check'
import { contextText, lukasText } from '../../../src/ai/prompt'
import { operatingRules } from '../../../src/ai/rules'
import { rubricCriteria } from '../../../src/ai/tools'
import type { LooseBlock } from '../../../src/domain/block'
import { appJudged, hardIssues } from '../../../src/domain/check'
import { FIXTURE_TIME, makeItem, makeProject, makeProposal } from '../../../src/domain/fixtures'
import { isBlank, isOffen, leerFields } from '../../../src/domain/profile'
import { reducer } from '../../../src/domain/reducer'
import { projectSchema, type Project, type StoredMessage } from '../../../src/domain/schemas/project'
import { rowText } from '../../../src/ui/proposals/describe'

// Step 0 (implementation plan step 14): "offen", the completeness criterion the app judges
// itself, the paste / interview / opening turns, and the card wording for the two forms.

const AT = '2026-11-08T10:00:00.000Z'
let n = 0
const meta = { at: AT, newId: () => `id${++n}` }
const texts = (m: StoredMessage) => m.content.map((b) => b.text as string)
const turns = (p: Project, step: 0 | 1 = 0) => p.steps[step].segments.flatMap((s) => s.messages)

const filledProfile = {
  name: 'Schraubzeit',
  organisation: 'Nachbarschaftshaus Am Weidengrund e. V.',
  projectBoundary: 'Die offene Werkstatt, nicht die Ferienkurse',
  location: 'Weidengrund-Siedlung',
  activities: ['Offene Werkstatt'],
  participants: 'Jugendliche von 12 bis 17',
  team: 'offen',
  duration: '2026–2027',
  funder: 'Stiftung Stadtteil Morgen',
  statedGoals: ['Mobiler werden'],
  otherOffers: ['offen'],
  openQuestions: [],
}
const filledFrame = { purpose: 'beides' as const, audience: 'Stiftung', requiredFormat: 'offen', requiredFigures: ['Teilnahmen'], existingData: ['Anwesenheitsliste'] }

function step0(profile: Record<string, unknown> = {}, frame: Record<string, unknown> = {}, extra: Parameters<typeof makeProject>[0] = {}) {
  return makeProject({
    ...extra,
    steps: {
      ...extra.steps,
      0: { status: 'in_progress', block: { profile: makeItem(0, 'profile', profile), frame: makeItem(0, 'frame', frame), sources: [] }, ...extra.steps?.[0] },
    },
  })
}

describe('"offen" and leer (domain/profile)', () => {
  it('"offen" is the word, in any case, or a list with only that entry', () => {
    expect(isOffen('offen')).toBe(true)
    expect(isOffen(' Offen ')).toBe(true)
    expect(isOffen(['offen'])).toBe(true)
    expect(isOffen(['offen', 'Kita'])).toBe(false)
    expect(isOffen('Offene Werkstatt')).toBe(false)
    expect(isBlank('')).toBe(true)
    expect(isBlank(['', ' '])).toBe(true)
    expect(isBlank(undefined)).toBe(true)
    expect(isBlank('offen')).toBe(false)
  })

  it('leer fields in form order across both forms; Budgetrahmen and "Noch zu klären" may stay empty; no choice for "Wofür?" counts', () => {
    const p = step0({ name: 'Schraubzeit', location: 'offen' })
    const leer = leerFields(p.steps[0].block as unknown as LooseBlock).map((f) => f.label)
    expect(leer.slice(0, 3)).toEqual(['Träger', 'Projektgrenze', 'Aktivitäten'])
    expect(leer).not.toContain('Ort')
    expect(leer).not.toContain('Budgetrahmen')
    expect(leer).not.toContain('Noch zu klären')
    expect(leer).toContain('Wofür?')
    expect(leer.at(-1)).toBe('Vorhandene Daten')
  })
})

describe('step 0 check (validator)', () => {
  it('has no ⛔ at all (no Why, no number limits, no links)', () => {
    expect(hardIssues(0, step0().steps[0].block as unknown as LooseBlock)).toEqual([])
  })

  it('criterion 1 is the app\'s: ⚠ with the leer fields and "Zum Feld" to the first, ✓ once all are filled or offen', () => {
    const [warn] = appJudged(0, step0({ name: 'Schraubzeit' }).steps[0].block as unknown as LooseBlock)
    expect(warn).toMatchObject({ criterion: '1', result: 'warn', target: { collection: 'profile', id: 'profile', field: 'organisation' } })
    expect(warn.note).toMatch(/^Noch leer, nicht als offen markiert: Träger, Projektgrenze, /)
    const [ok] = appJudged(0, step0(filledProfile, filledFrame).steps[0].block as unknown as LooseBlock)
    expect(ok).toEqual({ criterion: '1', result: 'ok', note: 'Jedes Feld ist ausgefüllt oder offen.' })
  })

  it('Claude may leave criterion 1 out; storing a check puts the app\'s judgement in place of Claude\'s', () => {
    const others = rubricCriteria(0).filter((c) => c.id !== '1').map((c) => ({ criterion: c.id, result: 'ok', note: 'Passt.' }))
    const parsed = parseCheck(0, { results: others })
    expect(parsed.ok).toBe(true)
    const claudeSaysOk = [{ criterion: '1', result: 'ok' as const, note: 'Alles da.' }, ...others.map((r) => ({ ...r, result: 'ok' as const }))]
    const p = step0({ name: 'Schraubzeit' })
    const stored = reducer(p, { type: 'check/store', step: 0, check: { at: AT, source: 'app', block: structuredClone(p.steps[0].block), results: claudeSaysOk } })
    const one = stored.steps[0].qualityCheck!.results.find((r) => r.criterion === '1')!
    expect(one.result).toBe('warn')
    expect(one.note).toContain('Träger')
  })

  it('"offen" values survive into the confirm snapshot', () => {
    const p = step0(filledProfile, filledFrame)
    const checked = reducer(p, { type: 'check/store', step: 0, check: { at: AT, source: 'app', block: structuredClone(p.steps[0].block), results: [] } })
    const confirmed = reducer(checked, { type: 'step/confirm', step: 0, at: AT })
    expect(confirmed.steps[0].status).toBe('confirmed')
    expect(confirmed.steps[0].confirmed!.block.profile.team).toBe('offen')
    expect(confirmed.steps[0].confirmed!.block.profile.otherOffers).toEqual(['offen'])
    expect(confirmed.steps[0].confirmed!.block.frame.requiredFormat).toBe('offen')
  })
})

describe('paste turn', () => {
  const text = 'Schraubzeit ist eine offene Fahrradwerkstatt. Dienstags und donnerstags kommen Jugendliche.'

  it('stores the source as Lukas\'s and sends its full text once, before the app line; the snapshot shows its length only', () => {
    const prepared = prepareAct(step0(), 0, { kind: 'paste', label: ' Antrag 2026 ', text: `  ${text}\n` }, meta)!
    const source = prepared.project.steps[0].block.sources[0]
    expect(source).toMatchObject({ id: 'src1', origin: 'paste', label: 'Antrag 2026', text, at: AT, editedByUser: true })
    const [turn] = turns(prepared.project)
    expect(turn.act).toEqual({ kind: 'paste', label: 'Antrag 2026', chars: text.length })
    const [context, sent, line, snapshot] = texts(turn)
    expect(context).toMatch(/^\[Projektstand\]/)
    expect(sent).toBe(`[Quelle src1: „Antrag 2026“]\n${text}`)
    expect(line).toBe('[App] Die Person hat einen Text eingefügt: „Antrag 2026“ (src1). Er steht direkt über dieser Zeile.')
    expect(lukasText(turn)).toBe(line)
    expect(snapshot).toContain(`"chars":${text.length}`)
    expect(snapshot).not.toContain('Dienstags')
    projectSchema.parse(prepared.project)
  })

  it('a later turn never repeats the text: the snapshot keeps the length', () => {
    const first = prepareAct(step0(), 0, { kind: 'paste', label: 'Antrag', text }, meta)!
    const later = prepareTurn(reducer(first.project, { type: 'item/edit', step: 0, collection: 'profile', id: 'profile', fields: { name: 'X' } }), 0, 'Weiter.', meta)
    const all = turns(later.project).flatMap(texts).join('\n')
    expect(all.split('Dienstags').length - 1).toBe(1)
  })

  it('no label → "Eingefügter Text N"; empty or over 150.000 Zeichen → nothing happens', () => {
    const prepared = prepareAct(step0(), 0, { kind: 'paste', label: '  ', text: 'Ein Text.' }, meta)!
    expect(prepared.project.steps[0].block.sources[0].label).toBe('Eingefügter Text 1')
    expect(prepareAct(step0(), 0, { kind: 'paste', label: 'x', text: '   ' }, meta)).toBeUndefined()
    expect(prepareAct(step0(), 0, { kind: 'paste', label: 'x', text: 'a'.repeat(MAX_PASTE + 1) }, meta)).toBeUndefined()
    expect(prepareAct(step0(), 1, { kind: 'paste', label: 'x', text: 'Ein Text.' }, meta)).toBeUndefined()
  })

  it('a new step 0 segment carries the sources (Claude would lose them with the old one)', () => {
    const first = prepareAct(step0(), 0, { kind: 'paste', label: 'Antrag', text }, meta)!
    const rolled = prepareTurn(first.project, 0, 'Weiter.', { ...meta, newSegment: { summary: 'Profil fast fertig.' } })
    const [context] = texts(rolled.project.steps[0].segments.at(-1)!.messages[0])
    expect(context).toContain('[Quellen aus Schritt 0, voller Text]')
    expect(context).toContain(text)
  })
})

describe('step 1 sees the sources, the later steps don\'t', () => {
  const source = makeItem(0, 'sources', { origin: 'paste', label: 'Antrag', text: 'Der ganze Antragstext.', at: FIXTURE_TIME })
  const p = makeProject({ steps: { 0: { status: 'confirmed', block: { sources: [source] } } } })
  it('step 1\'s context ends with the full text; step 2\'s has only the label', () => {
    expect(contextText(p, 1)).toContain('[Quelle src1: „Antrag“]\nDer ganze Antragstext.')
    expect(contextText(p, 2)).not.toContain('Der ganze Antragstext.')
    expect(contextText(p, 2)).toContain('"label":"Antrag"')
  })
})

describe('interview and opening turns', () => {
  it('the interview starts an empty step 0 chat, with an app line instead of Lukas\'s words', () => {
    const prepared = prepareAct(step0(), 0, { kind: 'interview' }, meta)!
    const [turn] = turns(prepared.project)
    expect(turn.act).toEqual({ kind: 'interview' })
    expect(lukasText(turn)).toMatch(/^\[App\] Die Person hat nichts Schriftliches und hat das Interview gestartet\./)
    expect(prepareAct(prepared.project, 0, { kind: 'interview' }, meta)).toBeUndefined()
  })

  it('the opening goes to step 1 only after step 0 is confirmed and while step 1\'s chat is empty', () => {
    const confirmed = makeProject({ steps: { 0: { status: 'confirmed' } } })
    expect(prepareAct(step0(), 1, { kind: 'opening' }, meta)).toBeUndefined()
    const prepared = prepareAct(confirmed, 1, { kind: 'opening' }, meta)!
    const [turn] = turns(prepared.project, 1)
    expect(turn.act).toEqual({ kind: 'opening' })
    expect(lukasText(turn)).toContain('Beginne mit deiner Eröffnung (Leitfaden Schritt 1, Abschnitt 4.1)')
    expect(prepareAct(prepared.project, 1, { kind: 'opening' }, meta)).toBeUndefined()
    expect(prepareAct(confirmed, 0, { kind: 'opening' }, meta)).toBeUndefined()
  })

  it('every step: text and the one question come before the tool call (a tool call ends the turn)', () => {
    for (const step of [0, 1] as const) expect(operatingRules(step, 'text')).toContain('Ruf das Werkzeug erst danach auf, als Letztes.')
  })

  it('the step 0 rules are only in step 0', () => {
    expect(operatingRules(0, 'text')).toContain('## Schritt 0 in der App')
    expect(operatingRules(0, 'text')).toContain('genau das Wort „offen“')
    expect(operatingRules(1, 'text')).not.toContain('## Schritt 0 in der App')
  })
})

describe('card wording for the forms', () => {
  const card = (p: Project, over: Record<string, unknown>) => {
    const proposal = makeProposal([{ op: 'update', collection: 'profile', targetId: 'profile', baseRev: 1, fields: over }])
    const withP = reducer(p, { type: 'proposal/add', step: 0, proposal })
    return rowText(withP, 0, proposal, proposal.changes[0], { kind: 'open' })
  }

  it('a first draft into an empty profile is one NEU row listing its fields; "offen" is flagged for the chip', () => {
    const row = card(step0(), { name: 'Schraubzeit', location: 'Weidengrund', team: 'offen' })
    expect(row).toMatchObject({ kind: 'new', noun: 'Projektprofil', main: '', draft: true })
    expect(row.fields).toEqual([
      { label: 'Name des Projekts', after: 'Schraubzeit' },
      { label: 'Ort', after: 'Weidengrund' },
      { label: 'Team', after: 'offen', offen: true },
    ])
  })

  it('once the profile has content: ÄNDERN, fields that were empty listed compactly, filled ones old → new', () => {
    const row = card(step0({ name: 'Schraubzeit' }), { name: 'Schraubzeit – offene Werkstatt', location: 'offen' })
    expect(row.kind).toBe('change')
    expect(row.draft).toBeUndefined()
    expect(row.fields).toEqual([
      { label: 'Name des Projekts', before: 'Schraubzeit', after: 'Schraubzeit – offene Werkstatt' },
      { label: 'Ort', after: 'offen', offen: true },
    ])
    expect(row.changedFields).toEqual(['name', 'location'])
  })
})
