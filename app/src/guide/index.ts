// The method guide is bundled at build time and becomes the assistant's
// system prompt (tech design §6.2). README.md and _log/ are not part of it.
import shared from '../../../method-guide/00-shared.md?raw'
import glossary from '../../../method-guide/glossary.md?raw'
import step0 from '../../../method-guide/step-0-context.md?raw'
import step1 from '../../../method-guide/step-1-target-groups.md?raw'
import step2 from '../../../method-guide/step-2-problem.md?raw'
import step3 from '../../../method-guide/step-3-goals.md?raw'
import step4 from '../../../method-guide/step-4-impact-logic.md?raw'
import step5 from '../../../method-guide/step-5-focus-indicators.md?raw'
import step6 from '../../../method-guide/step-6-data-plan.md?raw'

export const guideFiles = {
  '00-shared.md': shared,
  'glossary.md': glossary,
  'step-0-context.md': step0,
  'step-1-target-groups.md': step1,
  'step-2-problem.md': step2,
  'step-3-goals.md': step3,
  'step-4-impact-logic.md': step4,
  'step-5-focus-indicators.md': step5,
  'step-6-data-plan.md': step6,
} as const

export type GuideFileName = keyof typeof guideFiles

/** The guide file of a method step ("step-1-…"). */
export function stepGuide(step: number): { name: GuideFileName; text: string } {
  const name = (Object.keys(guideFiles) as GuideFileName[]).find((n) => n.startsWith(`step-${step}-`))
  if (!name) throw new Error(`No guide file for step ${step}`)
  return { name, text: guideFiles[name] }
}
