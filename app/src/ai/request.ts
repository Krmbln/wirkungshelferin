import type { BetaMessageParam, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Settings } from '../storage/settings'

// The options every call sends (tech design §6.1, §6.2). The connection test uses exactly
// these, so a passing test proves the API and Chrome accept what a chat turn will send.

/** Server-side refusal fallback, "default" form (routes by refusal category). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Per-call output limits; thinking counts against them (tech design §6.1). */
export const MAX_TOKENS = {
  chat: 16_000,
  check: 8_000,
  summary: 4_000,
  pdf: 32_000,
  connectionTest: 256,
} as const

type Call = { system: string; messages: BetaMessageParam[]; maxTokens: number }

export function requestParams(settings: Settings, { system, messages, maxTokens }: Call): BetaMessageStreamParams {
  return {
    model: settings.model,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: settings.effort },
    // Lukas often pauses longer than 5 minutes between turns.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages,
  }
}
