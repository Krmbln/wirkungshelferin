import { guideFiles, type GuideFileName } from '../guide'
import type { Status } from './components/StatusIcon'

// The seven method steps (PRD F2). Numbering 0–6 everywhere (design §5.2).
export type StepId = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type StepStatus = Extract<Status, 'todo' | 'progress' | 'done' | 'stale'>

export const parts = ['Kontext', 'Strategie', 'Analyse'] as const
export type Part = (typeof parts)[number]

export type Step = {
  id: StepId
  /** Sidebar name, one word. */
  short: string
  /** Full title, taken from the guide file's first heading. */
  title: string
  part: Part
  /** One sentence for the home page: what the step is about. */
  lead: string
}

const defs: { id: StepId; file: GuideFileName; short: string; part: Part; lead: string }[] = [
  { id: 0, file: 'step-0-context.md', short: 'Projekt', part: 'Kontext', lead: 'Was euer Projekt ist und was die Geldgeberin wissen will.' },
  { id: 1, file: 'step-1-target-groups.md', short: 'Gruppen', part: 'Strategie', lead: 'Welche Herausforderung ihr angeht, für wen ihr da seid und wer mitredet.' },
  { id: 2, file: 'step-2-problem.md', short: 'Problem', part: 'Strategie', lead: 'Welches Problem eure Zielgruppen haben und woher es kommt.' },
  { id: 3, file: 'step-3-goals.md', short: 'Ziele', part: 'Strategie', lead: 'Was sich für eure Zielgruppen verändern soll.' },
  { id: 4, file: 'step-4-impact-logic.md', short: 'Logik', part: 'Strategie', lead: 'Wie eure Aktivitäten zu diesen Zielen führen sollen.' },
  { id: 5, file: 'step-5-focus-indicators.md', short: 'Messen', part: 'Analyse', lead: 'Was ihr lernen wollt und woran ihr es messt.' },
  { id: 6, file: 'step-6-data-plan.md', short: 'Plan', part: 'Analyse', lead: 'Wer wann welche Daten sammelt.' },
]

/** "# Schritt 1 – Herausforderung, Zielgruppen & Beteiligte" → the part after the dash. */
export function guideTitle(markdown: string, id: StepId): string {
  const match = markdown.match(/^# Schritt (\d) – (.+)$/m)
  if (!match || Number(match[1]) !== id) throw new Error(`Guide heading for step ${id} not found`)
  return match[2].trim()
}

export const steps: Step[] = defs.map(({ file, ...def }) => ({ ...def, title: guideTitle(guideFiles[file], def.id) }))

export const stepsByPart = parts.map((part) => ({ part, steps: steps.filter((s) => s.part === part) }))

export type StepStatuses = Record<StepId, StepStatus>

/** Placeholder until the stored project exists (step 5): nothing started yet. */
export const initialStatuses: StepStatuses = { 0: 'todo', 1: 'todo', 2: 'todo', 3: 'todo', 4: 'todo', 5: 'todo', 6: 'todo' }

/** The first step that isn't confirmed; null when all are. Refined in step 22. */
export function recommendedStep(statuses: StepStatuses): StepId | null {
  return steps.find((s) => statuses[s.id] !== 'done')?.id ?? null
}

/** One-line status on the home page (design §6.1). Dates come with the stored project. */
export const homeStatusLine: Record<StepStatus, string> = {
  todo: 'noch nicht begonnen',
  progress: 'in Arbeit',
  done: 'bestätigt',
  stale: 'vielleicht veraltet – prüfen',
}

export type View = { kind: 'home' } | { kind: 'step'; step: StepId } | { kind: 'settings' }
