import type { LooseBlock } from './block'
import { itemBase, itemSchema, type Item } from './schemas/blocks'

// Step 0's two form singletons (design §6.2, step 14): profile and measurement frame. Unknown
// values are the word "offen", never a guess (PRD F3); a field that is neither filled nor
// "offen" is leer, which the completeness criterion reports.

export const OFFEN = 'offen'

export type FormName = 'profile' | 'frame'
export const FORMS: FormName[] = ['profile', 'frame']

/** German field labels, in form order (= schema order). Shared by the panel, the cards and the check. */
export const FORM_LABELS: Record<FormName, Record<string, string>> = {
  profile: {
    name: 'Name des Projekts',
    organisation: 'Träger',
    projectBoundary: 'Projektgrenze',
    location: 'Ort',
    activities: 'Aktivitäten',
    participants: 'Teilnehmende',
    team: 'Team',
    duration: 'Laufzeit',
    funder: 'Finanzierung',
    budgetRange: 'Budgetrahmen',
    statedGoals: 'Ziele laut Dokument',
    otherOffers: 'Ähnliche Angebote',
    openQuestions: 'Noch zu klären',
  },
  frame: {
    purpose: 'Wofür?',
    audience: 'Für wen?',
    requiredFormat: 'Format',
    requiredFigures: 'Pflichtangaben',
    existingData: 'Vorhandene Daten',
  },
}

/** Fields that may stay empty: optional, or empty means "nothing" (guide step 0 §6). */
export const MAY_BE_EMPTY: Record<FormName, string[]> = { profile: ['budgetRange', 'openQuestions'], frame: [] }

const offenText = (value: unknown) => typeof value === 'string' && value.trim().toLowerCase() === OFFEN

/** Explicitly unknown. A list is "offen" when its only entry is. */
export function isOffen(value: unknown): boolean {
  return Array.isArray(value) ? value.length === 1 && offenText(value[0]) : offenText(value)
}

/** Nothing in it: '' / no entries / no option chosen. */
export function isBlank(value: unknown): boolean {
  if (Array.isArray(value)) return !value.some((v) => typeof v === 'string' && v.trim())
  return typeof value !== 'string' || !value.trim()
}

/** The form's field names in order. */
export const formFields = (form: FormName) => Object.keys(itemSchema(0, form)!.shape).filter((k) => !(k in itemBase))

/** True while no field of the form holds anything (not even "offen"). */
export const formEmpty = (item: Item, form: FormName) => formFields(form).every((f) => isBlank(item[f]))

/** Fields that are neither filled nor "offen", in form order, across both forms. */
export function leerFields(block: LooseBlock): { form: FormName; field: string; label: string }[] {
  return FORMS.flatMap((form) => {
    const item = block[form] as Item
    return formFields(form)
      .filter((field) => !MAY_BE_EMPTY[form].includes(field) && isBlank(item[field]))
      .map((field) => ({ form, field, label: FORM_LABELS[form][field] }))
  })
}
