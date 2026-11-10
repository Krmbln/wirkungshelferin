import type { BetaJSONOutputFormat, BetaMessageParam, BetaMessageStreamParams, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Effort, Settings } from '../storage/settings'

// The options every call sends (tech design §6.1, §6.2). The connection test uses exactly
// these, so a passing test proves the API and Chrome accept what a chat turn will send.

/** Server-side refusal fallback, "default" form (routes by refusal category). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Per-call output limits; thinking counts against them (tech design §6.1). */
export const MAX_TOKENS = {
  chat: 16_000,
  check: 8_000,
  summary: 4_000,
  /** The home card's summary (step 22): two short fields at effort low. */
  resume: 2_000,
  pdf: 32_000,
  connectionTest: 256,
} as const

export type Call = {
  system: string
  messages: BetaMessageParam[]
  maxTokens: number
  /** The step's tools (tools.ts); they sit before the system prompt in the cached prefix. */
  tools?: BetaTool[]
  /** Overrides the setting for mechanical calls (PDF extraction). */
  effort?: Effort
  /** Structured output: the answer's text is JSON of this schema (the home summary). */
  format?: BetaJSONOutputFormat
}

export function requestParams(settings: Settings, { system, messages, maxTokens, tools, effort, format }: Call): BetaMessageStreamParams {
  return {
    model: settings.model,
    max_tokens: maxTokens,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    // Adaptive is the only mode on this model; sent explicitly so every call states it.
    thinking: { type: 'adaptive' },
    output_config: { effort: effort ?? settings.effort, ...(format && { format }) },
    ...(tools && { tools, tool_choice: { type: 'auto' } }),
    // Lukas often pauses longer than 5 minutes between turns.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages,
  }
}
