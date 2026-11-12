// Pure helpers of the app run (implementation plan step 25a): reading the page snapshot,
// pricing API calls, the stuck rule, key redaction. No browser, no network — tested in lib.test.ts.

/** Roles the simulated user can act on. */
export const ACTIONABLE = ['button', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'link', 'tab', 'menuitem', 'option', 'spinbutton', 'slider'] as const
const TYPABLE = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])

export type Element = {
  /** Index shown to the user model. */
  i: number
  role: string
  /** Accessible name ("" if none). */
  name: string
  /** Position among the snapshot's elements with the same role and name (for `.nth`). */
  nth: number
  /** Extra state the snapshot printed: [checked], [disabled], a field's value. */
  state: string
}

const LINE = new RegExp(`^\\s*- (${ACTIONABLE.join('|')})(?: "((?:[^"\\\\]|\\\\.)*)")?(.*)$`)
// A key YAML can't leave bare (a name with ": ") comes single-quoted: - 'button "A: B"': text
const QUOTED = /^(\s*- )'((?:[^']|'')*)'(.*)$/

/** The actionable elements of a Playwright aria snapshot, in page order. */
export function parseElements(snapshot: string): Element[] {
  const seen = new Map<string, number>()
  const out: Element[] = []
  for (const raw of snapshot.split('\n')) {
    const q = QUOTED.exec(raw)
    const line = q ? q[1] + q[2].replace(/''/g, "'") + q[3] : raw
    const m = LINE.exec(line)
    if (!m) continue
    const role = m[1]
    const name = (m[2] ?? '').replace(/\\(.)/g, '$1')
    const key = `${role}\u0000${name}`
    const nth = seen.get(key) ?? 0
    seen.set(key, nth + 1)
    out.push({ i: out.length, role, name, nth, state: m[3].replace(/:$/, '').trim() })
  }
  return out
}

export function describe(e: Element): string {
  return `[${e.i}] ${e.role}${e.name ? ` "${e.name}"` : ''}${e.state ? ` ${e.state}` : ''}`
}

export type Action = {
  kind: 'click' | 'type' | 'paste_application' | 'wait' | 'stuck'
  element: number
  text: string
  thought: string
}

/** The structured output the user model must return (strict JSON schema). */
export const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'Was du gerade denkst und warum du das tust (1–2 Sätze, als die Person).' },
    kind: { type: 'string', enum: ['click', 'type', 'paste_application', 'wait', 'stuck'] },
    element: { type: 'integer', description: 'Nummer des Bedienelements; -1 bei wait/stuck.' },
    text: { type: 'string', description: 'Bei type: was du eintippst. Sonst leer.' },
  },
  required: ['thought', 'kind', 'element', 'text'],
  additionalProperties: false,
} as const

/** Why an action can't run on these elements, or null. */
export function invalidReason(a: Action, elements: Element[]): string | null {
  if (a.kind === 'wait' || a.kind === 'stuck') return null
  const e = elements[a.element]
  if (!e) return `Element ${a.element} gibt es nicht.`
  if (/\bdisabled\b/.test(e.state)) return `${describe(e)} ist gerade nicht bedienbar.`
  if (a.kind === 'type' || a.kind === 'paste_application') {
    if (!TYPABLE.has(e.role)) return `${describe(e)} ist kein Textfeld.`
    if (a.kind === 'type' && !a.text.trim()) return 'Bei type fehlt der Text.'
  }
  return null
}

// ---- Cost ----

/** $ per million tokens. Cache writes by TTL (the app uses 1 h). */
type Price = { input: number; output: number; read: number; write5m: number; write1h: number }
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, read: 0.2, write5m: 5, write1h: 8 },
  'claude-opus-5': { input: 5, output: 25, read: 0.5, write5m: 6.25, write1h: 10 },
  'claude-sonnet-5-5': { input: 2, output: 10, read: 0.2, write5m: 2.5, write1h: 4 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, read: 0.01, write5m: 0.125, write1h: 0.2 },
}

export type Usage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null
}

/** Cost of one call in $. An unknown model is priced as Opus 5 (the dearest listed), so the cap errs on the safe side. */
export function cost(model: string, u: Usage): { usd: number; known: boolean } {
  const p = PRICES[model]
  const price = p ?? PRICES['claude-opus-5']
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens
  const w1 = u.cache_creation?.ephemeral_1h_input_tokens
  // Without the TTL split, every write counts at the 1 h price (what the app asks for).
  const writes = w5 != null || w1 != null ? (w5 ?? 0) * price.write5m + (w1 ?? 0) * price.write1h : (u.cache_creation_input_tokens ?? 0) * price.write1h
  const usd = ((u.input_tokens ?? 0) * price.input + (u.output_tokens ?? 0) * price.output + (u.cache_read_input_tokens ?? 0) * price.read + writes) / 1e6
  return { usd, known: Boolean(p) }
}

/** Model and final usage of a Messages API response body: an SSE stream or plain JSON. */
export function usageOf(body: string): { model: string; usage: Usage } | null {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as { model?: string; usage?: Usage }
      return json.usage ? { model: json.model ?? '', usage: json.usage } : null
    } catch {
      return null
    }
  }
  let model = ''
  let usage: Usage | null = null
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    let event: { type?: string; message?: { model?: string; usage?: Usage }; usage?: Usage }
    try {
      event = JSON.parse(line.slice(5))
    } catch {
      continue
    }
    if (event.type === 'message_start' && event.message) {
      model = event.message.model ?? ''
      usage = { ...event.message.usage }
    } else if (event.type === 'message_delta' && event.usage && usage) {
      // message_delta carries the final (cumulative) counts; nulls mean "unchanged".
      for (const [k, v] of Object.entries(event.usage)) if (v != null) (usage as Record<string, unknown>)[k] = v
    }
  }
  return usage ? { model, usage } : null
}

// ---- Stuck rule ----

/** Counts actions in a row after which the screen didn't change; 3 = stuck (plan step 25a). */
export class StuckWatch {
  private still = 0
  readonly limit: number
  constructor(limit = 3) {
    this.limit = limit
  }
  /** Feed the screen before and after one action; true once the limit is reached. */
  record(before: string, after: string): boolean {
    this.still = before === after ? this.still + 1 : 0
    return this.still >= this.limit
  }
  get count(): number {
    return this.still
  }
}

// ---- Secrets ----

/** Removes the given secrets and anything shaped like an Anthropic key. */
export function redact(text: string, secrets: string[] = []): string {
  let out = text
  for (const s of secrets) if (s.length >= 8) out = out.split(s).join('[KEY]')
  return out.replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, '[KEY]')
}

/** Step id the sidebar marks as current, from its aria-label ("3 Ziele, in Arbeit"). */
export function stepFromLabel(label: string | null): number | null {
  const m = label ? /^([0-6]) /.exec(label) : null
  return m ? Number(m[1]) : null
}
