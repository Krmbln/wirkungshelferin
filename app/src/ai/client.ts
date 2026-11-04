import Anthropic from '@anthropic-ai/sdk'
import type { Settings } from '../storage/settings'
import { classifyError, logAiError, type AiProblem } from './errors'
import { MAX_TOKENS, requestParams } from './request'

export type ConnectionResult = { ok: true } | { ok: false; problem: AiProblem }

/** The app's only way to Claude. The SDK version talks to the API; tests and the gallery use the mock. */
export interface AiClient {
  /** One tiny call with the real chat options and the given key, model and effort. */
  testConnection(settings: Settings): Promise<ConnectionResult>
}

type Options = {
  /** Tests pass a fake; the app uses the browser's. */
  fetch?: typeof fetch
  online?: () => boolean
  /** The SDK retries 429/5xx and connection errors twice by default (tech design §6.7). */
  maxRetries?: number
}

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
  }
}
