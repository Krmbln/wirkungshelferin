// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sdkAiClient, STALL_TIMEOUT } from '../../../src/ai/client'
import { FALLBACK_BETA, MAX_TOKENS } from '../../../src/ai/request'
import { stepTools } from '../../../src/ai/tools'
import { defaultSettings, type Settings } from '../../../src/storage/settings'
import { dummyKey } from '../../dummyKey'
import { errorBody, sseAnswer, sseError } from '../../fakeClaude'

// The real SDK client against a fake fetch: what goes out, and how answers and errors come back.

const settings: Settings = { ...defaultSettings, apiKey: dummyKey, effort: 'high' }

type Sent = { url: string; headers: Headers; body: Record<string, unknown> }

function fakeFetch(respond: () => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    sent.push({ url: request.url, headers: request.headers, body: (await request.json()) as Record<string, unknown> })
    return respond()
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent, calls: fetch }
}

const sse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
const failure = (status: number, type: string, message?: string) =>
  new Response(errorBody(type, message), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } })

const client = (fetch: typeof globalThis.fetch, online = true) => sdkAiClient({ fetch, online: () => online, maxRetries: 0 })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('connection test: request options = a chat call', () => {
  it('sends the fallback beta, effort, the 1-hour cache and the browser header, streamed', async () => {
    const fake = fakeFetch(() => sse(sseAnswer()))
    expect(await client(fake.fetch).testConnection(settings)).toEqual({ ok: true })
    const [{ url, headers, body }] = fake.sent
    expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(headers.get('anthropic-beta')).toBe(FALLBACK_BETA)
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
    // SDK 1.x sends the key as a bearer token.
    expect(headers.get('authorization')).toBe(`Bearer ${dummyKey}`)
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: MAX_TOKENS.connectionTest,
      fallbacks: 'default',
      output_config: { effort: 'high' },
      stream: true,
      system: [{ type: 'text', cache_control: { type: 'ephemeral', ttl: '1h' } }],
    })
    // Thinking can't be turned off on this model; adaptive is stated explicitly.
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })

  it('uses the model from the settings', async () => {
    const fake = fakeFetch(() => sse(sseAnswer()))
    await client(fake.fetch).testConnection({ ...settings, model: 'claude-sonnet-5-5' })
    expect(fake.sent[0].body.model).toBe('claude-sonnet-5-5')
  })

  it('an answer cut at max_tokens still proves the connection', async () => {
    const fake = fakeFetch(() => sse(sseAnswer('max_tokens')))
    expect(await client(fake.fetch).testConnection(settings)).toEqual({ ok: true })
  })
})

describe('connection test: failures', () => {
  const cases: [string, () => Response, string][] = [
    ['401 → key', () => failure(401, 'authentication_error', 'invalid x-api-key'), 'key'],
    ['402 → credit', () => failure(402, 'billing_error'), 'credit'],
    ['404 → model', () => failure(404, 'not_found_error'), 'model'],
    ['429 → busy', () => failure(429, 'rate_limit_error'), 'busy'],
    ['529 → busy', () => failure(529, 'overloaded_error'), 'busy'],
    ['overloaded mid-stream → busy', () => sse(sseError('overloaded_error')), 'busy'],
    ['refusal → refusal', () => sse(sseAnswer('refusal')), 'refusal'],
  ]
  it.each(cases)('%s', async (_, respond, problem) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await client(fakeFetch(respond).fetch).testConnection(settings)).toEqual({ ok: false, problem })
  })

  it('a network failure while online: not reachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await client(fake.fetch).testConnection(settings)).toEqual({ ok: false, problem: 'unreachable' })
  })

  it('offline: says so at once, without a request', async () => {
    const fake = fakeFetch(() => sse(sseAnswer()))
    expect(await client(fake.fetch, false).testConnection(settings)).toEqual({ ok: false, problem: 'offline' })
    expect(fake.calls).not.toHaveBeenCalled()
  })

  it('no key: no request', async () => {
    const fake = fakeFetch(() => sse(sseAnswer()))
    expect(await client(fake.fetch).testConnection(defaultSettings)).toEqual({ ok: false, problem: 'key' })
    expect(fake.calls).not.toHaveBeenCalled()
  })

  it('the key never appears in a log, even when the API echoes it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const fake = fakeFetch(() => failure(401, 'authentication_error', `invalid x-api-key ${dummyKey}`))
    await client(fake.fetch).testConnection(settings)
    expect(log).toHaveBeenCalledWith('Connection test failed', expect.objectContaining({ status: 401, requestId: 'req_test' }))
    const logged = JSON.stringify([log.mock.calls, warn.mock.calls, info.mock.calls])
    expect(logged).not.toContain(dummyKey)
    expect(logged).not.toContain(dummyKey.slice(-12))
  })
})

describe('send: one streamed call', () => {
  const call = {
    system: 'System',
    messages: [{ role: 'user' as const, content: 'Hallo' }],
    maxTokens: MAX_TOKENS.chat,
    tools: stepTools(1),
  }

  it('sends the step tools with auto tool choice and the shared options', async () => {
    const fake = fakeFetch(() => sse(sseAnswer()))
    const result = await client(fake.fetch).send(settings, call)
    expect(result.status).toBe('done')
    expect(result.status === 'done' && result.message.content).toEqual([expect.objectContaining({ type: 'text', text: 'OK' })])
    const { body, headers } = fake.sent[0]
    expect(headers.get('anthropic-beta')).toBe(FALLBACK_BETA)
    expect(body).toMatchObject({ max_tokens: 16_000, fallbacks: 'default', output_config: { effort: 'high' }, tool_choice: { type: 'auto' } })
    expect((body.tools as { name: string; strict: boolean }[]).map((t) => [t.name, t.strict])).toEqual([
      ['propose_changes', true],
      ['report_quality_check', true],
    ])
  })

  it('a per-call effort overrides the setting', async () => {
    const fake = fakeFetch(() => sse(sseAnswer()))
    await client(fake.fetch).send(settings, { ...call, effort: 'low' })
    expect(fake.sent[0].body.output_config).toEqual({ effort: 'low' })
  })

  it('a refusal is a finished answer; the caller reads stop_reason', async () => {
    const result = await client(fakeFetch(() => sse(sseAnswer('refusal'))).fetch).send(settings, call)
    expect(result.status === 'done' && result.message.stop_reason).toBe('refusal')
  })

  it('failures map like the connection test; no key or offline means no request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await client(fakeFetch(() => failure(529, 'overloaded_error')).fetch).send(settings, call)).toEqual({ status: 'failed', problem: 'busy' })
    const fake = fakeFetch(() => sse(sseAnswer()))
    expect(await client(fake.fetch, false).send(settings, call)).toEqual({ status: 'failed', problem: 'offline' })
    expect(await client(fake.fetch).send(defaultSettings, call)).toEqual({ status: 'failed', problem: 'key' })
    expect(fake.calls).not.toHaveBeenCalled()
  })

  it('stopped mid-stream: aborted, with what had arrived', async () => {
    // The first two events arrive, then the stream waits until the request is aborted.
    const [start, block] = sseAnswer().split('\n\n')
    const hanging = vi.fn(async (_: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${start}\n\n${block}\n\n`))
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const controller = new AbortController()
    const events: string[] = []
    const result = await client(hanging as unknown as typeof fetch).send(settings, call, {
      signal: controller.signal,
      onEvent: (e) => {
        events.push(e.type)
        if (e.type === 'content_block_start') controller.abort()
      },
    })
    expect(events).toEqual(['message_start', 'content_block_start'])
    expect(result.status).toBe('aborted')
    expect(result.status === 'aborted' && result.partial?.content).toEqual([{ type: 'text', text: '' }])
  })
})

describe('send: a stalled stream (step 24)', () => {
  const call = { system: 'System', messages: [{ role: 'user' as const, content: 'Hallo' }], maxTokens: MAX_TOKENS.chat }
  const encode = (text: string) => new TextEncoder().encode(text)
  const [start, block, ...rest] = sseAnswer('end_turn', 'Hallo zurück.').split('\n\n')
  const ping = 'event: ping\ndata: {"type": "ping"}\n\n'

  /** A response that sends `first`, then (optionally) pings every `every` ms for `pings` times, then `last`. */
  function scripted({ first = '', pings = 0, every = 0, last }: { first?: string; pings?: number; every?: number; last?: string }) {
    return vi.fn(async (_: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
          if (first) controller.enqueue(encode(first))
          for (let i = 0; i < pings; i++) {
            await new Promise((r) => setTimeout(r, every))
            if (init?.signal?.aborted) return
            controller.enqueue(encode(ping))
          }
          if (last !== undefined) {
            controller.enqueue(encode(last))
            controller.close()
          }
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
  }
  const stalling = (fetch: typeof globalThis.fetch, stallMs = 60) => sdkAiClient({ fetch, online: () => true, maxRetries: 0, stallMs })

  it('waits 90 s by default', () => {
    expect(STALL_TIMEOUT).toBe(90_000)
  })

  it('no byte at all: fails as "not reachable" instead of waiting for the 10-minute timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await stalling(scripted({})).send(settings, call)
    expect(result).toEqual({ status: 'failed', problem: 'unreachable' })
  })

  it('a slow upload is no stall: the watchdog starts with the response', async () => {
    // The request takes 150 ms to be answered (a big PDF going up), against a 60 ms limit.
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 150))
      return sse(sseAnswer())
    }) as unknown as typeof fetch
    expect((await stalling(slow).send(settings, call)).status).toBe('done')
  })

  it('stalled after some text: fails with what had arrived, for display', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await stalling(scripted({ first: `${start}\n\n${block}\n\n` })).send(settings, call)
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.problem).toBe('unreachable')
    expect(result.status === 'failed' && result.partial?.content).toEqual([{ type: 'text', text: '' }])
  })

  it('a retried 529 is no stall: the watchdog starts with the successful response', async () => {
    // 529 with a 120 ms retry wait, then 100 ms until the retry is answered, against a 60 ms limit.
    let calls = 0
    const retried = vi.fn(async () => {
      if (calls++ === 0) return new Response(errorBody('overloaded_error'), { status: 529, headers: { 'content-type': 'application/json', 'retry-after-ms': '120' } })
      await new Promise((r) => setTimeout(r, 100))
      return sse(sseAnswer())
    }) as unknown as typeof fetch
    const result = await sdkAiClient({ fetch: retried, online: () => true, maxRetries: 1, stallMs: 60 }).send(settings, call)
    expect(calls).toBe(2)
    expect(result.status).toBe('done')
  })

  it('a stall while the network is gone says "offline"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let online = true
    const fetch = scripted({ first: `${start}\n\n` })
    const result = await sdkAiClient({ fetch, online: () => online, maxRetries: 0, stallMs: 60 }).send(settings, call, {
      onEvent: () => void (online = false),
    })
    expect(result).toMatchObject({ status: 'failed', problem: 'offline' })
  })

  it('pings keep a quiet stream alive: no event for longer than the limit, still done', async () => {
    // 6 pings 25 ms apart = 150 ms without an event the SDK shows, against a 60 ms limit.
    const result = await stalling(scripted({ first: `${start}\n\n`, pings: 6, every: 25, last: `${[block, ...rest].join('\n\n')}` })).send(settings, call)
    expect(result.status).toBe('done')
    expect(result.status === 'done' && result.message.content).toEqual([{ type: 'text', text: 'Hallo zurück.' }])
  })

  it('a finished answer leaves no watchdog timer behind', async () => {
    const set = vi.spyOn(globalThis, 'setTimeout')
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const result = await stalling(scripted({ last: sseAnswer() }), 61).send(settings, call)
    expect(result.status).toBe('done')
    const watchdog = set.mock.results.filter((_, i) => set.mock.calls[i][1] === 61).map((r) => r.value)
    expect(watchdog.length).toBeGreaterThan(0)
    expect(clear).toHaveBeenLastCalledWith(watchdog.at(-1))
  })

  it('Stopp still wins while the watchdog runs: aborted, not failed', async () => {
    const controller = new AbortController()
    const result = await stalling(scripted({ first: `${start}\n\n` }), 5_000).send(settings, call, {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === 'message_start') controller.abort()
      },
    })
    expect(result.status).toBe('aborted')
  })
})

