import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_MODEL } from '../storage/settings'

// API errors in plain German (tech design §6.7). The UI shows only these texts; the console
// gets status, type and request id, never a message or header that could carry the key.

export type AiProblem = 'key' | 'credit' | 'model' | 'busy' | 'offline' | 'unreachable' | 'refusal' | 'other'

export function classifyError(error: unknown, online: boolean): AiProblem {
  // A subclass of APIError in the TS SDK, so it comes first.
  if (error instanceof Anthropic.APIConnectionError) return online ? 'unreachable' : 'offline'
  if (error instanceof Anthropic.APIError) {
    if (error.type === 'billing_error' || error.status === 402) return 'credit'
    // Older accounts got "credit balance is too low" as a plain 400.
    if (error.status === 400 && /credit balance/i.test(error.message)) return 'credit'
    if (error.status === 401 || error.status === 403) return 'key'
    if (error.status === 404) return 'model'
    // Mid-stream errors carry no status, only the type.
    if (error.status === 429 || error.status === 529 || error.type === 'rate_limit_error' || error.type === 'overloaded_error')
      return 'busy'
  }
  return online ? 'other' : 'offline'
}

/**
 * `setup`: no app frame yet, so nothing may point to the settings page.
 * `chat`: the key worked before; the chat shows a link to the settings next to the text.
 */
export function problemText(problem: AiProblem, model: string, place: 'app' | 'setup' | 'chat' = 'app'): string {
  switch (problem) {
    case 'key':
      if (place === 'chat') return 'Dein API-Schlüssel funktioniert nicht mehr. Trag in den Einstellungen einen neuen ein.'
      return 'Claude nimmt diesen API-Schlüssel nicht an. Prüf, ob du ihn ganz kopiert hast. Wenn ja, gib Karim Bescheid.'
    case 'credit':
      return 'Das Guthaben für Claude ist aufgebraucht. Gib Karim Bescheid.'
    case 'model':
      if (place === 'setup') return `Claude kennt das eingestellte Modell „${model}“ nicht. Gib Karim Bescheid.`
      return `Claude kennt das Modell „${model}“ nicht. Prüf den Namen in den Einstellungen. Standard ist ${DEFAULT_MODEL}.`
    case 'busy':
      return 'Claude ist gerade überlastet. Warte kurz und versuch es dann noch einmal.'
    case 'offline':
      return 'Keine Internetverbindung. Prüf dein WLAN und versuch es dann noch einmal.'
    case 'unreachable':
      return 'Claude ist gerade nicht erreichbar. Versuch es gleich noch einmal.'
    case 'refusal':
      return 'Claude hat diese Anfrage abgelehnt. Versuch es noch einmal.'
    case 'other':
      return 'Das hat nicht geklappt. Versuch es noch einmal. Wenn es wieder passiert, gib Karim Bescheid.'
  }
}

/** For Karim's debugging: codes only (design §7.3), nothing from the request. */
export function logAiError(context: string, error: unknown): void {
  if (error instanceof Anthropic.APIError) {
    console.error(context, { name: error.constructor.name, status: error.status, type: error.type, requestId: error.requestID })
  } else {
    console.error(context, { name: error instanceof Error ? error.name : typeof error })
  }
}
