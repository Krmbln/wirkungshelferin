// Run: node --test eval/app-run/lib.test.ts (Node 24 strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StuckWatch, cost, invalidReason, parseElements, redact, stepFromLabel, usageOf, type Action } from './lib.ts'

const SNAPSHOT = `- complementary:
  - button "Übersicht" [pressed]
  - button "1 Gruppen, in Arbeit"
- main:
  - heading "Schritt 1 · Zielgruppen" [level=1]
  - paragraph: Wen erreicht ihr?
  - button "Übernehmen"
  - checkbox "Fokusgruppe" [checked]
  - button "Übernehmen"
  - button [disabled]
  - textbox "Nachricht an Claude": halb getippt
  - link "Sag \\"Hallo\\"":
    - /url: https://example.org`

test('parseElements lists actionable elements in order with nth per role + name', () => {
  const els = parseElements(SNAPSHOT)
  assert.deepEqual(
    els.map((e) => [e.i, e.role, e.name, e.nth, e.state]),
    [
      [0, 'button', 'Übersicht', 0, '[pressed]'],
      [1, 'button', '1 Gruppen, in Arbeit', 0, ''],
      [2, 'button', 'Übernehmen', 0, ''],
      [3, 'checkbox', 'Fokusgruppe', 0, '[checked]'],
      [4, 'button', 'Übernehmen', 1, ''],
      [5, 'button', '', 0, '[disabled]'],
      [6, 'textbox', 'Nachricht an Claude', 0, ': halb getippt'],
      [7, 'link', 'Sag "Hallo"', 0, ''],
    ],
  )
})

// Exact lines Playwright 1.64 printed for these names (scratchpad probe, step 25a): run 1 missed them all.
test('parseElements reads single-quoted lines (names with ": ")', () => {
  const snap = [
    `- 'button "Übernehmen: Neu – Projektprofil"'`,
    `- 'button "Bezug wählen: Planzeile 1"': Bezug wählen`,
    `- 'button "Sag \\"x\\": y"': a`,
    `- 'checkbox "Ziel: Ann''s Gruppe" [checked]'`,
    `- button "Alle übernehmen"`,
  ].join('\n')
  assert.deepEqual(
    parseElements(snap).map((e) => [e.role, e.name, e.state]),
    [
      ['button', 'Übernehmen: Neu – Projektprofil', ''],
      ['button', 'Bezug wählen: Planzeile 1', ': Bezug wählen'],
      ['button', 'Sag "x": y', ': a'],
      ['checkbox', "Ziel: Ann's Gruppe", '[checked]'],
      ['button', 'Alle übernehmen', ''],
    ],
  )
})

test('parseElements skips headings, text and urls', () => {
  assert.equal(parseElements('- heading "X" [level=1]\n- paragraph: Hallo\n- /url: x').length, 0)
})

test('invalidReason refuses missing, disabled and non-text targets', () => {
  const els = parseElements(SNAPSHOT)
  const a = (kind: Action['kind'], element: number, text = ''): Action => ({ kind, element, text, thought: '' })
  assert.equal(invalidReason(a('click', 2), els), null)
  assert.match(invalidReason(a('click', 99), els)!, /gibt es nicht/)
  assert.match(invalidReason(a('click', 5), els)!, /nicht bedienbar/)
  assert.match(invalidReason(a('type', 2, 'hi'), els)!, /kein Textfeld/)
  assert.match(invalidReason(a('type', 6, '  '), els)!, /fehlt der Text/)
  assert.equal(invalidReason(a('type', 6, 'Joa, so ungefähr.'), els), null)
  assert.equal(invalidReason(a('paste_application', 6), els), null)
  assert.equal(invalidReason(a('stuck', -1), els), null)
})

test('cost prices Opus 5.5 with the 1 h cache split', () => {
  const { usd, known } = cost('claude-opus-5-5', {
    input_tokens: 1_000,
    output_tokens: 2_000,
    cache_read_input_tokens: 20_000,
    cache_creation_input_tokens: 3_000,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3_000 },
  })
  // 1000×4 + 2000×20 + 20000×0.2 + 3000×8 = 4000 + 40000 + 4000 + 24000 = 72000 / 1e6
  assert.equal(known, true)
  assert.ok(Math.abs(usd - 0.072) < 1e-9)
})

test('cost counts writes without a TTL split at the 1 h price, unknown models as Opus 5', () => {
  assert.ok(Math.abs(cost('claude-opus-5-5', { cache_creation_input_tokens: 1_000_000 }).usd - 8) < 1e-9)
  const unknown = cost('claude-mystery', { input_tokens: 1_000_000 })
  assert.equal(unknown.known, false)
  assert.equal(unknown.usd, 5)
})

test('usageOf reads an SSE stream: message_start, then message_delta overrides non-null counts', () => {
  const ev = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`
  const body =
    ev({ type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 500 } } }) +
    ev({ type: 'content_block_delta', delta: { text: 'data: {"type":"message_start"}' } }) +
    ev({ type: 'message_delta', usage: { output_tokens: 321, cache_read_input_tokens: null } })
  assert.deepEqual(usageOf(body), { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 321, cache_read_input_tokens: 500 } })
})

test('usageOf reads plain JSON and returns null for an error body', () => {
  assert.deepEqual(usageOf('{"model":"claude-haiku-5-5","usage":{"input_tokens":3,"output_tokens":4}}'), {
    model: 'claude-haiku-5-5',
    usage: { input_tokens: 3, output_tokens: 4 },
  })
  assert.equal(usageOf('{"type":"error","error":{"type":"overloaded_error"}}'), null)
  assert.equal(usageOf(''), null)
})

test('StuckWatch fires on the third unchanged screen in a row, a change resets it', () => {
  const w = new StuckWatch()
  assert.equal(w.record('a', 'a'), false)
  assert.equal(w.record('a', 'a'), false)
  assert.equal(w.record('a', 'b'), false)
  assert.equal(w.count, 0)
  assert.equal(w.record('b', 'b'), false)
  assert.equal(w.record('b', 'b'), false)
  assert.equal(w.record('b', 'b'), true)
})

test('redact removes the given key and any key-shaped string', () => {
  // Built from parts so the repo's leak scanner doesn't flag the made-up keys (step 1 lesson).
  const key = 'sk-' + 'ant-api03-abcDEF123_xyz-987'
  const other = 'sk-' + 'ant-zzzzzzzzzz'
  assert.equal(redact(`key=${key} other ${other} end`, [key]), 'key=[KEY] other [KEY] end')
  assert.equal(redact('nothing secret'), 'nothing secret')
})

test('stepFromLabel reads the sidebar step row label', () => {
  assert.equal(stepFromLabel('3 Ziele, in Arbeit'), 3)
  assert.equal(stepFromLabel('0 Kontext, nicht begonnen'), 0)
  assert.equal(stepFromLabel('Übersicht'), null)
  assert.equal(stepFromLabel(null), null)
})
