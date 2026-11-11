import Anthropic, { APIUserAbortError } from '@anthropic-ai/sdk'
import type { BetaMessage, BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Settings } from '../storage/settings'
import { classifyError, logAiError, type AiProblem } from './errors'
import { MAX_TOKENS, requestParams, type Call } from './request'

export type ConnectionResult = { ok: true } | { ok: false; problem: AiProblem }

export type SendResult =
  | { status: 'done'; message: BetaMessage }
  /** Stopped by the caller: what had arrived so far, if anything. */
  | { status: 'aborted'; partial?: BetaMessage }
  /** `partial`: what arrived before a stream broke, for display only. */
  | { status: 'failed'; problem: AiProblem; partial?: BetaMessage }

export type SendOptions = {
  signal?: AbortSignal
  /** Every raw stream event, in order (streamed rendering, step 9). */
  onEvent?: (event: BetaRawMessageStreamEvent) => void
}

/** The app's only way to Claude. The SDK version talks to the API; tests and the gallery use the mock. */
export interface AiClient {
  /** One tiny call with the real chat options and the given key, model and effort. */
  testConnection(settings: Settings): Promise<ConnectionResult>
  /** One streamed call (chat turn, check, summary, PDF). A refusal comes back as done; the caller checks stop_reason. */
  send(settings: Settings, call: Call, options?: SendOptions): Promise<SendResult>
}

type Options = {
  /** Tests pass a fake; the app uses the browser's. */
  fetch?: typeof fetch
  online?: () => boolean
  /** The SDK retries 429/5xx and connection errors twice by default (tech design §6.7). */
  maxRetries?: number
  /** How long a call may go without a single byte before it counts as stalled. */
  stallMs?: number
}

/** Long turns stream for minutes; the SDK's default ceiling. */
const CALL_TIMEOUT = 10 * 60_000

/**
 * A stream that sends nothing for this long has stalled (step 24; seen once in the step 22 PO
 * run: "denkt nach …" for 10 minutes). Counted on the raw bytes, so the API's pings (which the
 * SDK drops) keep a long thinking phase alive.
 */
export const STALL_TIMEOUT = 90_000

/**
 * A fetch that calls `alive` when a successful response arrives and for every chunk of its body.
 * The SDK never shows pings, so this is the only place that sees them. Nothing before that: a
 * 24 MB PDF can take minutes to upload, and a 429/529 is retried after a wait of its own; neither
 * is a stall (the SDK's timeout covers them). A successful stream is never retried.
 */
function watchedFetch(base: typeof fetch, alive: () => void): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init)
    if (!response.ok || !response.body) return response
    alive()
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          alive()
          controller.enqueue(chunk)
        },
      }),
    )
    return new Response(body, response)
  }
}

const TEST_SYSTEM = 'Verbindungstest der Wirkungshelferin.'
const TEST_MESSAGE = 'Antworte nur mit „OK“.'

export function sdkAiClient({ fetch: fetchImpl, online = () => navigator.onLine, maxRetries = 2, stallMs = STALL_TIMEOUT }: Options = {}): AiClient {
  // Settings can change at any time, so every call builds its client from them.
  function client(apiKey: string, timeout: number, fetch?: typeof globalThis.fetch) {
    return new Anthropic({
      apiKey,
      // Sends the direct-browser-access header (tech design §6.1).
      dangerouslyAllowBrowser: true,
      // The SDK's own logging is off; logAiError writes codes only.
      logLevel: 'off',
      timeout,
      maxRetries,
      ...((fetch ?? fetchImpl) && { fetch: fetch ?? fetchImpl }),
    })
  }

  return {
    async testConnection(settings) {
      if (!settings.apiKey) return { ok: false, problem: 'key' }
      // No request without a network: the SDK would retry first, and Lukas would wait for nothing.
      if (!online()) return { ok: false, problem: 'offline' }
      try {
        const params = requestParams(settings, {
          system: TEST_SYSTEM,
          messages: [{ role: 'user', content: TEST_MESSAGE }],
          maxTokens: MAX_TOKENS.connectionTest,
        })
        const message = await client(settings.apiKey, 30_000).beta.messages.stream(params).finalMessage()
        // max_tokens is fine here: Claude answered, so key, model and options work.
        if (message.stop_reason === 'refusal') return { ok: false, problem: 'refusal' }
        return { ok: true }
      } catch (error) {
        logAiError('Connection test failed', error)
        return { ok: false, problem: classifyError(error, online()) }
      }
    },

    async send(settings, call, { signal, onEvent } = {}) {
      if (!settings.apiKey) return { status: 'failed', problem: 'key' }
      if (!online()) return { status: 'failed', problem: 'offline' }
      let stream: ReturnType<Anthropic['beta']['messages']['stream']> | undefined
      // Stall watchdog: aborts the call when no byte has come for stallMs; the caller's Stopp still wins.
      const stall = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const alive = () => {
        clearTimeout(timer)
        timer = setTimeout(() => stall.abort(), stallMs)
      }
      const watched = watchedFetch(fetchImpl ?? globalThis.fetch.bind(globalThis), alive)
      try {
        stream = client(settings.apiKey, CALL_TIMEOUT, watched).beta.messages.stream(requestParams(settings, call), {
          signal: signal ? AbortSignal.any([signal, stall.signal]) : stall.signal,
        })
        if (onEvent) stream.on('streamEvent', onEvent)
        return { status: 'done', message: await stream.finalMessage() }
      } catch (error) {
        const partial = stream?.currentMessage
        if (signal?.aborted) return { status: 'aborted', partial }
        if (stall.signal.aborted) {
          // Shown like a lost connection (step 9 banner with "Erneut versuchen"); offline if the network went.
          logAiError('Call stalled', error)
          return { status: 'failed', problem: online() ? 'unreachable' : 'offline', ...(partial?.content.length && { partial }) }
        }
        if (error instanceof APIUserAbortError) return { status: 'aborted', partial }
        logAiError('Call failed', error)
        return { status: 'failed', problem: classifyError(error, online()), ...(partial?.content.length && { partial }) }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
