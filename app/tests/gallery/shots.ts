import type { Locator, Page } from '@playwright/test'

export const SHOT_DIR = 'screenshots/gallery'

// Opens the gallery with fonts loaded, so screenshots never catch the fallback font.
export async function openGallery(page: Page): Promise<void> {
  await page.goto('./?gallery')
  await page.getByRole('heading', { name: 'Zustandsgalerie' }).waitFor()
  await page.evaluate(() => document.fonts.ready)
}

export const state = (page: Page, name: string): Locator => page.locator(`[data-state="${name}"]`)

/** Saves one named gallery state, or a whole section by its heading. */
export async function shot(target: Locator, file: string): Promise<void> {
  await target.screenshot({ path: `${SHOT_DIR}/${file}.png`, animations: 'disabled' })
}

export function section(page: Page, title: string): Locator {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}
