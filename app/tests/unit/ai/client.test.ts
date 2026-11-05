// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sdkAiClient } from '../../../src/ai/client'
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
