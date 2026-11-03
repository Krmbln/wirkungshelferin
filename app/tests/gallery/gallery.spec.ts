import { expect, test, type Page } from '@playwright/test'
import { openGallery, section, shot, state } from './shots'

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

const sections = [
  'Farben',
  'Schrift',
  'Button · Primär',
  'Button · Sekundär',
  'Button · Text',
  'Button · Varianten im Einsatz',
  'Icons',
  'Status',
  'Chips',
  'Banner',
  'Dialog',
  'Bewegung',
  'Sperrbildschirm',
]

test('renders every section with the self-hosted font and no errors', async ({ page }) => {
  const errors = watchErrors(page)
  await openGallery(page)

  expect(await page.evaluate(() => document.fonts.check('400 16px "Source Sans 3"'))).toBe(true)
  expect(await page.evaluate(() => document.fonts.check('600 16px "Source Sans 3"'))).toBe(true)

  for (const [i, title] of sections.entries()) {
    const s = section(page, title)
    await expect(s).toBeVisible()
    await shot(s, `${String(i + 1).padStart(2, '0')}-${title.replace(/[^\wäöü]+/gi, '-').toLowerCase()}`)
  }
  await page.screenshot({ path: 'screenshots/gallery/00-full-page.png', fullPage: true, animations: 'disabled' })
  expect(errors).toEqual([])
})

test('forced hover and pressed states match the real pointer states', async ({ page }) => {
  // No transitions, so computed colours are final right away.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openGallery(page)
  const look = (name: string) =>
    state(page, name)
      .getByRole('button')
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return `${s.backgroundColor} ${s.color} ${s.textDecorationLine}`
      })

  for (const variant of ['primary', 'secondary', 'text']) {
    const rest = state(page, `button-${variant}-rest`).getByRole('button')
    await rest.hover()
    expect(await look(`button-${variant}-rest`)).toBe(await look(`button-${variant}-hover`))
    await page.mouse.down()
    expect(await look(`button-${variant}-rest`)).toBe(await look(`button-${variant}-pressed`))
    await page.mouse.up()
    await page.mouse.move(0, 0)
  }
})

test('all button states look different from each other', async ({ page }) => {
  await openGallery(page)
  for (const variant of ['primary', 'secondary', 'text']) {
    const looks = await Promise.all(
      ['rest', 'hover', 'pressed', 'disabled'].map((s) =>
        state(page, `button-${variant}-${s}`)
          .getByRole('button')
          .evaluate((el) => {
            const c = getComputedStyle(el)
            return `${c.backgroundColor} ${c.color} ${c.borderColor} ${c.textDecorationLine}`
          }),
      ),
    )
    // The text button has no pressed look of its own (design §3: "—"); it keeps the hover underline.
    const distinct = variant === 'text' ? 3 : 4
    expect(new Set(looks).size, `${variant}: ${looks.join(' | ')}`).toBe(distinct)
  }
})

test('keyboard focus shows the 2 px accent ring', async ({ page }) => {
  await openGallery(page)
  const button = page.locator('[data-gallery-focus]')
  await button.focus()
  await expect(button).toBeFocused()
  const outline = await button.evaluate((el) => {
    const s = getComputedStyle(el)
    return [s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor]
  })
  expect(outline).toEqual(['solid', '2px', '2px', 'rgb(31, 107, 102)'])
  await shot(state(page, 'button-focus'), 'focus-ring')
})

test('busy button: a double click starts one run', async ({ page }) => {
  await openGallery(page)
  const button = state(page, 'button-busy-live').getByRole('button')
  await button.dblclick()
  await expect(button).toHaveText('prüft …')
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).toHaveText('Prüfen und bestätigen', { timeout: 4000 })
})

test('term tooltip opens on Enter and closes on Esc', async ({ page }) => {
  await openGallery(page)
  const trigger = state(page, 'tooltip-term').locator('.tooltip__trigger')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip', { name: /Aktivitäten/ })).toBeVisible()
  await shot(section(page, 'Tooltip'), 'tooltip-open')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
})

test('dialog is modal, traps focus and closes on Esc', async ({ page }) => {
  await openGallery(page)
  await page.getByRole('button', { name: 'Dialog öffnen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup laden?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused()
  await page.screenshot({ path: 'screenshots/gallery/dialog-open.png', animations: 'disabled' })

  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('reduced motion stops the pulse', async ({ page }) => {
  const animation = () => page.locator('.thinking__dot').evaluate((el) => getComputedStyle(el).animationName)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openGallery(page)
  expect(await animation()).toBe('thinking-pulse')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(animation).toBe('none')
})
