import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { classifyError, problemText, type AiProblem } from '../../../src/ai/errors'

const apiError = (status: number, type: string, message = 'test') =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers())
// What the SDK throws for an error event inside a stream: no status, only the type.
const streamError = (type: Anthropic.ErrorType) => new Anthropic.APIError(undefined, { type: 'error', error: { type } }, undefined, new Headers(), type)

// Tech design §6.7: every case maps to a plain German message with what to do.
describe('error mapper', () => {
  const cases: [string, unknown, AiProblem][] = [
    ['401 invalid key', apiError(401, 'authentication_error'), 'key'],
    ['403 key not allowed', apiError(403, 'permission_error'), 'key'],
    ['402 billing', apiError(402, 'billing_error'), 'credit'],
    ['400 "credit balance is too low"', apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the API'), 'credit'],
    ['404 unknown model', apiError(404, 'not_found_error'), 'model'],
    ['429 rate limit', apiError(429, 'rate_limit_error'), 'busy'],
    ['529 overloaded', apiError(529, 'overloaded_error'), 'busy'],
    ['overloaded mid-stream (no status)', streamError('overloaded_error'), 'busy'],
    ['other 400', apiError(400, 'invalid_request_error'), 'other'],
    ['500', apiError(500, 'api_error'), 'other'],
  ]
  it.each(cases)('%s', (_, error, problem) => {
    expect(classifyError(error, true)).toBe(problem)
  })

  it('connection error: offline when the browser is offline, else not reachable', () => {
    const error = new Anthropic.APIConnectionError({ message: 'fetch failed' })
    expect(classifyError(error, false)).toBe('offline')
    expect(classifyError(error, true)).toBe('unreachable')
    expect(classifyError(new Anthropic.APIConnectionTimeoutError(), true)).toBe('unreachable')
  })

  it('anything unknown while offline is "offline"', () => {
    expect(classifyError(new TypeError('x'), false)).toBe('offline')
    expect(classifyError(new TypeError('x'), true)).toBe('other')
  })

  it('texts are plain German with what to do, no codes', () => {
    const problems: AiProblem[] = ['key', 'credit', 'model', 'busy', 'offline', 'unreachable', 'refusal', 'other']
    for (const p of problems) {
      const text = problemText(p, 'claude-opus-5-5')
      expect(text).not.toMatch(/\d{3}|error|_/i)
      expect(text).not.toContain('!')
    }
    expect(problemText('offline', 'm')).toMatch(/^Keine Internetverbindung/)
    expect(problemText('credit', 'm')).toMatch(/Karim Bescheid/)
    expect(problemText('model', 'claude-x')).toContain('„claude-x“')
  })
})
