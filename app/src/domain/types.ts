// Shared domain primitives (tech design §7).
export const stepIds = [0, 1, 2, 3, 4, 5, 6] as const
export type StepId = (typeof stepIds)[number]

export const stepStatuses = ['not_started', 'in_progress', 'confirmed', 'maybe_outdated'] as const
export type StepStatus = (typeof stepStatuses)[number]

// Evidence basis labels (PRD F5), shown in German by the UI.
export const evidenceLabels = ['unsicher', 'eigene_erfahrung', 'eigene_daten', 'forschung'] as const
export type Evidence = (typeof evidenceLabels)[number]
