// The simulated user (step 25a): Haiku plays a project lead who has never seen the app. Each turn
// it gets the page as an aria snapshot plus its own last actions, and returns one action as
// structured output. `ScriptedUser` stands in for it in the free smoke run (--fake).
import { ACTION_SCHEMA, describe, type Action, type Element, type Usage } from './lib.ts'

export const USER_MODEL = 'claude-haiku-5-5'

export type Turn = { snapshot: string; elements: Element[]; history: string[]; note?: string }
export type Decision = { action: Action; usage?: Usage; model?: string }
export interface User {
  next(turn: Turn): Promise<Decision>
}

const SNAPSHOT_LIMIT = 60_000

export function personaSystem(facts: string): string {
  return `Du spielst eine echte Person, die zum ersten Mal die Web-App „Wirkungshelferin“ benutzt. Die App hilft, mit einer KI-Assistentin („Claude“) Schritt für Schritt die Wirkungslogik und einen Messplan für ein soziales Projekt zu erarbeiten.

Wer du bist und was du über dein Projekt weißt, steht im Faktenblatt unten. Halte dich daran: Sprich wie die Person, gib versteckte Fakten nur preis, wenn danach gefragt wird, und bring deine Vorstöße ein. Erfinde keine Fakten, die nicht im Faktenblatt stehen; wenn du etwas nicht weißt, sag das ehrlich („weiß ich nicht genau“).

Über die App weißt du nichts. Du siehst den Bildschirm nur als Textabbild (Überschriften, Texte, Bedienelemente) und bedienst sie wie ein normaler Mensch ohne Technikwissen: Du liest, was da steht, und tust das Naheliegende. Dein Ziel ist, mit der App alle Schritte für dein Projekt durchzuarbeiten, bis zum Ende.

Pro Zug machst du genau eine Aktion:
- click: ein Bedienelement anklicken (element = Nummer aus der Liste).
- type: in ein Textfeld schreiben und Enter drücken (im Chat heißt das: abschicken). Schreib so, wie die Person schreiben würde, meist kurz.
- paste_application: deinen Förderantrag (den hast du als Text, nicht als PDF) in ein Textfeld einfügen, ohne Enter.
- wait: warten, wenn die App gerade arbeitet.
- stuck: wenn du wirklich nicht weißt, was du jetzt tun sollst oder was die App von dir will. Schreib dann in thought genau, woran es hängt. Das ist erlaubt und hilfreich, rate nicht blind herum.

Antworte der Assistentin im Chat auf ihre Fragen. Wenn sie dir etwas vorschlägt, entscheide als die Person (meist annehmen, wenn es passt; widersprechen, wenn es nicht stimmt). Wenn ein Schritt fertig aussieht, schließ ihn ab und geh zum nächsten.

=== Faktenblatt ===
${facts}`
}

export function turnPrompt(turn: Turn): string {
  const snapshot = turn.snapshot.length > SNAPSHOT_LIMIT ? `…(oberer Teil gekürzt)…\n${turn.snapshot.slice(-SNAPSHOT_LIMIT)}` : turn.snapshot
  return [
    turn.history.length ? `Deine letzten Aktionen:\n${turn.history.join('\n')}` : 'Du öffnest die App gerade zum ersten Mal.',
    turn.note ? `Hinweis: ${turn.note}` : '',
    `Der Bildschirm jetzt:\n${snapshot}`,
    `Bedienelemente:\n${turn.elements.map(describe).join('\n') || '(keine)'}`,
    'Was tust du als Nächstes? Genau eine Aktion.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

type Client = { messages: { create(body: object): Promise<{ content: { type: string; text?: string }[]; usage: Usage; model: string; stop_reason: string }> } }

export class HaikuUser implements User {
  private client: Client
  private system: string
  constructor(client: Client, facts: string) {
    this.client = client
    this.system = personaSystem(facts)
  }

  async next(turn: Turn): Promise<Decision> {
    const res = await this.client.messages.create({
      model: USER_MODEL,
      max_tokens: 4000,
      system: this.system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ACTION_SCHEMA } },
      messages: [{ role: 'user', content: turnPrompt(turn) }],
    })
    const text = res.content.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
    let action: Action
    try {
      action = JSON.parse(text) as Action
    } catch {
      action = { kind: 'stuck', element: -1, text: '', thought: `(Antwort des Nutzermodells unlesbar, stop_reason ${res.stop_reason})` }
    }
    return { action, usage: res.usage, model: res.model }
  }
}

const PREFER = ['Neu starten', 'Weiter', 'Alle übernehmen', 'Übernehmen', 'Prüfen', 'Bestätigen', 'Trotzdem bestätigen']

/** Free stand-in for the smoke run: types once into the chat, then clicks the next obvious button. */
export class ScriptedUser implements User {
  private typed = 0
  async next(turn: Turn): Promise<Decision> {
    const chat = turn.elements.find((e) => e.role === 'textbox' && /Nachricht|Antwort|Chat/i.test(e.name))
    if (chat && this.typed < 1) {
      this.typed++
      return { action: { kind: 'type', element: chat.i, text: 'Joa, wir machen ein Sprachcafé.', thought: 'Antworten.' } }
    }
    for (const name of PREFER) {
      const e = turn.elements.find((x) => x.role === 'button' && x.name === name && !/disabled/.test(x.state))
      if (e) return { action: { kind: 'click', element: e.i, text: '', thought: `„${name}“ klingt richtig.` } }
    }
    return { action: { kind: 'stuck', element: -1, text: '', thought: 'Kein bekannter Knopf.' } }
  }
}
