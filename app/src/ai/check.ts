import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { LooseBlock } from '../domain/block'
import { appOwned, hardIssues, issueContext, sameBlock } from '../domain/check'
import type { Project, QualityCheck } from '../domain/schemas/project'
import type { StepId } from '../domain/types'
import { CHECK, checkInput, rubricCriteria } from './tools'

// The gate's "Prüfen" (design §6.2, PO decision 2026-11-08): a request of its own, not a chat
// turn. It is the chat's stored history plus one more user turn asking for the check, so it
// reads the cached prefix; nothing of it is stored. Claude's next chat turn hears about the
// result (and a confirm) as "[App]" lines.

/** The extra user turn of the check request (chat.ts `checkCall`). */
export const CHECK_REQUEST =
  'Die Person hat im Qualitätscheck auf „Prüfen“ geklickt. Prüfe den Baustein jetzt gegen die Rubrik dieses Schritts und melde das Ergebnis nur mit ' +
  `\`${CHECK}\`: jedes Kriterium genau einmal. Kein Vorschlag, kein Text.`

type Parsed = { ok: true; results: QualityCheck['results'] } | { ok: false; errors: string[] }

/**
 * A report_quality_check input → results in rubric order. Every criterion must be there exactly
 * once, except those the app owns (hard rules, app-judged criteria): the rules tell Claude the
 * app checks them, so a missing one counts as ✓ from the app (its ⛔ rows still win when they
 * find something, and the reducer puts the app's own judgement in place).
 */
export function parseCheck(step: StepId, input: unknown): Parsed {
  const parsed = checkInput(step).safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`) }
  const byId = new Map<string, QualityCheck['results'][number]>()
  const errors: string[] = []
  for (const r of parsed.data.results) {
    if (byId.has(r.criterion)) errors.push(`Kriterium ${r.criterion} kommt mehrfach vor.`)
    byId.set(r.criterion, r)
  }
  for (const id of appOwned(step)) if (!byId.has(id)) byId.set(id, { criterion: id, result: 'ok', note: APP_CHECKED })
  const missing = rubricCriteria(step)
    .map((c) => c.id)
    .filter((id) => !byId.has(id))
  if (missing.length) errors.push(`Es fehlen die Kriterien ${missing.join(', ')}.`)
  if (errors.length) return { ok: false, errors }
  return { ok: true, results: rubricCriteria(step).map((c) => byId.get(c.id)!) }
}

/** The note of a hard-rule criterion Claude left out. */
export const APP_CHECKED = 'Von der App geprüft.'

/** The newest valid check in a complete answer; none, an invalid one or a cut-off answer = no result. */
export function checkFromAnswer(step: StepId, message: Pick<BetaMessage, 'content' | 'stop_reason'>): QualityCheck['results'] | undefined {
  if (message.stop_reason === 'max_tokens') return undefined
  const uses = message.content.filter((b) => b.type === 'tool_use' && b.name === CHECK)
  for (const use of uses.reverse()) {
    const parsed = parseCheck(step, (use as { input: unknown }).input)
    if (parsed.ok) return parsed.results
  }
  return undefined
}

/** When Lukas's last stored turn in the step was sent (any segment); none = never. */
function lastTurnAt(project: Project, step: StepId): string | undefined {
  return project.steps[step].segments
    .flatMap((s) => s.messages)
    .findLast((m) => m.role === 'user')?.at
}

/** What Claude should hear in the next turn: a check from the gate and a confirm since the last turn. */
export function checkEvents(project: Project, step: StepId): string[] {
  const state = project.steps[step]
  const since = lastTurnAt(project, step) ?? ''
  const events: string[] = []
  const check = state.qualityCheck
  if (check?.source === 'app' && check.at > since) {
    const names = new Map(rubricCriteria(step).map((c) => [c.id, c.name]))
    const hard = hardIssues(step, check.block as LooseBlock, ...issueContext(project))
    const blocked = new Set(hard.map((i) => i.criterion))
    const lines = [
      ...hard.map((i) => `⛔ ${i.text}`),
      ...check.results.filter((r) => !blocked.has(r.criterion)).map((r) => `${r.result === 'ok' ? '✓' : '⚠'} ${r.criterion} ${names.get(r.criterion) ?? ''}: ${r.note}`),
    ]
    const older = sameBlock(check.block, state.block) ? '' : ' (für einen älteren Stand des Bausteins)'
    events.push(`Die Person hat den Qualitätscheck in der App ausgeführt${older}. Ergebnis:\n${lines.join('\n')}`)
  }
  // The stored fact, not the current check (a later check may judge differently); told even
  // when Lukas has edited since.
  const confirmed = state.confirmed
  if (confirmed && confirmed.at > since) {
    const warnings = state.confirmedWarnings
    events.push(
      warnings.length
        ? `Die Person hat den Schritt bestätigt, mit offenen Punkten (⚠ ${warnings.join(', ')}).`
        : 'Die Person hat den Schritt bestätigt.',
    )
  }
  return events
}
