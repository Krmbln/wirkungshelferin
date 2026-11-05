import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sdkAiClient } from '../src/ai/client'

// Recorded SSE bodies from `npm run contract` (tests/fixtures/sse/), replayed through the
// real SDK client. Node-only (reads files); Playwright routes read the same files.

export const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/sse/', import.meta.url))

export const fixtureNames = () =>
  readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.sse'))
    .map((f) => f.slice(0, -4))
    .sort()

export const fixtureBody = (name: string) => readFileSync(`${FIXTURE_DIR}${name}.sse`, 'utf8')

/** The project the recorded request saw, if the contract saved one (`<name>.json`). */
export function fixtureState(name: string): { step: number; project: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}.json`, 'utf8'))
  } catch {
    return undefined
  }
}

/** A fetch that answers every request with the recorded body. */
export const replayFetch = (body: string) =>
  (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch

export const replayClient = (name: string) => sdkAiClient({ fetch: replayFetch(fixtureBody(name)), online: () => true, maxRetries: 0 })

/** The JSON data of every event in a body, in order. */
export const sseEvents = (body: string) =>
  body
    .split('\n\n')
    .filter((chunk) => chunk.trim())
    .map((chunk) => JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as { type: string } & Record<string, unknown>)
