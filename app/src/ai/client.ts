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
  | { status: 'failed'; problem: AiProblem }

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
}

/** Long turns stream for minutes; the SDK's default ceiling. */
const CALL_TIMEOUT = 10 * 60_000

const TEST_SYSTEM = 'Verbindungstest der Wirkungshelferin.'
const TEST_MESSAGE = 'Antworte nur mit „OK“.'

export function sdkAiClient({ fetch: fetchImpl, online = () => navigator.onLine, maxRetries = 2 }: Options = {}): AiClient {
  // Settings can change at any time, so every call builds its client from them.
  function client(apiKey: string, timeout: number) {
    return new Anthropic({
      apiKey,
      // Sends the direct-browser-access header (tech design §6.1).
      dangerouslyAllowBrowser: true,
      // The SDK's own logging is off; logAiError writes codes only.
      logLevel: 'off',
      timeout,
      maxRetries,
      ...(fetchImpl && { fetch: fetchImpl }),
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
      try {
        stream = client(settings.apiKey, CALL_TIMEOUT).beta.messages.stream(requestParams(settings, call), { signal })
        if (onEvent) stream.on('streamEvent', onEvent)
        return { status: 'done', message: await stream.finalMessage() }
      } catch (error) {
        if (error instanceof APIUserAbortError || signal?.aborted) return { status: 'aborted', partial: stream?.currentMessage }
        logAiError('Call failed', error)
        return { status: 'failed', problem: classifyError(error, online()) }
      }
    },
  }
}
