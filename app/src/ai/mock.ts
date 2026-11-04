import type { Settings } from '../storage/settings'
import type { AiClient, ConnectionResult } from './client'

// Scripted AiClient for tests and the gallery: answers in the given order, then repeats the last.
export function scriptedAiClient(
  script: ConnectionResult[] = [{ ok: true }],
  { delay = 0 }: { delay?: number } = {},
): AiClient & { calls: Settings[] } {
  const calls: Settings[] = []
  return {
    calls,
    async testConnection(settings) {
      calls.push(settings)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      return script[Math.min(calls.length - 1, script.length - 1)]
    },
  }
}
