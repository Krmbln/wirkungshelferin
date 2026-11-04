// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sdkAiClient } from '../../../src/ai/client'
import { FALLBACK_BETA, MAX_TOKENS } from '../../../src/ai/request'
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
    // Thinking can't be turned off on this model; the request leaves it at the default.
    expect(body).not.toHaveProperty('thinking')
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
