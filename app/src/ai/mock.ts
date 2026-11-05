import type { Settings } from '../storage/settings'
import type { AiClient, ConnectionResult, SendResult } from './client'
import type { Call } from './request'

// Scripted AiClient for tests and the gallery: answers in the given order, then repeats the last.
// Recorded streams replay through the real SDK client with a fake fetch instead (tests/replay.ts).
export function scriptedAiClient(
  script: ConnectionResult[] = [{ ok: true }],
  { delay = 0, replies = [{ status: 'failed', problem: 'other' }] }: { delay?: number; replies?: SendResult[] } = {},
): AiClient & { calls: Settings[]; sent: Call[] } {
  const calls: Settings[] = []
  const sent: Call[] = []
  return {
    calls,
    sent,
    async send(_settings, call) {
      sent.push(call)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      return replies[Math.min(sent.length - 1, replies.length - 1)]
    },
    async testConnection(settings) {
      calls.push(settings)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      return script[Math.min(calls.length - 1, script.length - 1)]
    },
  }
}
