import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The contract's fetch: the app's own request, plus two things only the contract does.
// 1. It opts into the strict history check (thinking-binding beta, "error"), so an edited
//    history fails here even on an account that isn't enforced yet.
// 2. It records raw SSE response bodies (never headers, never the request) as fixtures.
// 3. It measures silence on the wire (step 24): the longest gap between bytes, and between events
//    the SDK shows (pings left out), to size the client's stall timeout from real streams.

export const FIXTURES = fileURLToPath(new URL('../fixtures/sse/', import.meta.url))
export const BINDING_BETA = 'thinking-binding-controls-2026-08-01'

export type Recorder = {
  fetch: typeof fetch
  /** Record the next response body under this name (`<name>.sse`). */
  recordNext(name: string): void
  /** The JSON body of the last request, as the app built it (before the opt-in was added). */
  lastRequest(): Record<string, unknown> | undefined
  /** The body of the last non-2xx response, for the report. */
  lastError(): string | undefined
  /** Resolves when the recorded body is on disk (also after an abort). */
  flushed(): Promise<void>
  /** Longest silences so far, in ms, and the pings seen. */
  gaps(): Gaps
}

export type Gaps = { bytes: number; events: number; pings: number }

/** Passes the body through and measures the gaps between its chunks and between its non-ping events. */
function measured(body: ReadableStream<Uint8Array>, gaps: Gaps): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  let lastByte = Date.now()
  let lastEvent = lastByte
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const now = Date.now()
        gaps.bytes = Math.max(gaps.bytes, now - lastByte)
        lastByte = now
        const events = [...decoder.decode(chunk, { stream: true }).matchAll(/^event: (\S+)/gm)].map((m) => m[1])
        gaps.pings += events.filter((e) => e === 'ping').length
        if (events.some((e) => e !== 'ping')) {
          gaps.events = Math.max(gaps.events, now - lastEvent)
          lastEvent = now
        }
        controller.enqueue(chunk)
      },
    }),
  )
}

export function recorder(): Recorder {
  let name: string | undefined
  let request: Record<string, unknown> | undefined
  let error: string | undefined
  let writing: Promise<void> = Promise.resolve()
  const gaps: Gaps = { bytes: 0, events: 0, pings: 0 }

  const wrapped = async (input: string | URL | Request, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    request = structuredClone(body)
    body.thinking = { ...(body.thinking as object), block_binding: { prefix_mismatch_behavior: 'error' } }
    const headers = new Headers(init.headers)
    headers.set('anthropic-beta', [headers.get('anthropic-beta'), BINDING_BETA].filter(Boolean).join(','))

    const response = await fetch(input, { ...init, headers, body: JSON.stringify(body) })
    const target = name
    name = undefined
    if (!response.ok) {
      error = await response.clone().text()
      return response
    }
    error = undefined
    if (!response.body) return response
    const meta = { status: response.status, statusText: response.statusText, headers: response.headers }
    const piped = measured(response.body, gaps)
    if (!target) return new Response(piped, meta)
    const [forApp, forFile] = piped.tee()
    writing = save(target, forFile)
    return new Response(forApp, meta)
  }

  return {
    fetch: wrapped as typeof fetch,
    recordNext: (n) => void (name = n),
    lastRequest: () => request,
    lastError: () => error,
    flushed: () => writing,
    gaps: () => ({ ...gaps }),
  }
}

/** Reads the body to the end, or to the point an abort cut it, and writes what arrived. */
async function save(name: string, stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    // Aborted: keep the complete events that arrived.
    text = text.slice(0, text.lastIndexOf('\n\n') + 2)
  }
  mkdirSync(FIXTURES, { recursive: true })
  writeFileSync(`${FIXTURES}${name}.sse`, text)
}
