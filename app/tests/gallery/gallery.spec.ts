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
  'App-Rahmen',
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

const screenNames = ['home', 'home-mixed', 'step', 'step-mixed', 'settings', 'saved', 'save-failed', 'save-failed-step']
// Without the app frame (no navigation).
const bareScreens = ['skeleton', 'empty', 'empty-error', 'second-tab', 'load-invalid', 'load-newer', 'load-storage']

async function openScreen(page: Page, name: string) {
  await page.goto(`./?gallery&screen=${name}`)
  await page.locator(bareScreens.includes(name) ? '#root > *' : 'nav').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

test('full-window screens render without errors', async ({ page }) => {
  const errors = watchErrors(page)
  for (const name of [...screenNames, ...bareScreens]) {
    await openScreen(page, name)
    await page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  }
  expect(errors).toEqual([])
})

test('save failure: ⛔ banner above the header, "Gespeichert" muted in the header', async ({ page }) => {
  await openScreen(page, 'save-failed')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Speichern hat nicht geklappt')
  const [banner, header] = await Promise.all([alert.boundingBox(), page.locator('.page-header').boundingBox()])
  expect(banner && header && banner.y + banner.height <= header.y).toBe(true)

  await openScreen(page, 'saved')
  const saved = page.locator('[data-slot="saved"]')
  await expect(saved).toHaveText('Gespeichert')
  const colours = await page.evaluate(() => ({
    saved: getComputedStyle(document.querySelector('[data-slot="saved"]')!).color,
    muted: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(),
  }))
  expect(colours.saved).toBe(await page.evaluate((c) => {
    const el = document.createElement('span')
    el.style.color = c
    document.body.append(el)
    const v = getComputedStyle(el).color
    el.remove()
    return v
  }, colours.muted))
})

test('after-action lines: backup downloaded during a save failure, unreadable data saved', async ({ page }) => {
  await openScreen(page, 'save-failed')
  await page.getByRole('button', { name: 'Backup speichern' }).click()
  await expect(page.getByRole('alert')).toContainText('Backup ist in deinen Downloads.')
  await page.screenshot({ path: 'screenshots/gallery/screen-save-failed-downloaded.png', animations: 'disabled' })

  await openScreen(page, 'load-invalid')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Daten als Datei sichern' }).click()
  expect((await download).suggestedFilename()).toMatch(/^wirkungshelferin-daten-\d{4}-\d{2}-\d{2}\.json$/)
  await expect(page.getByRole('button', { name: 'Mit einem Backup weitermachen' })).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-load-invalid-saved.png', animations: 'disabled' })
})

test('empty state: two equal options side by side', async ({ page }) => {
  await openScreen(page, 'empty')
  const options = page.locator('.empty__option')
  await expect(options).toHaveCount(2)
  const [a, b] = await Promise.all([options.nth(0).boundingBox(), options.nth(1).boundingBox()])
  expect(a && b && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1 && Math.abs(a.y - b.y) < 1).toBe(true)
})

test('current step: accent-soft row with accent text', async ({ page }) => {
  await openScreen(page, 'step-mixed')
  const row = page.locator('nav [aria-current="page"]')
  await expect(row).toHaveAttribute('aria-label', '3 Ziele, in Arbeit')
  const look = await row.evaluate((el) => {
    const s = getComputedStyle(el)
    return [s.backgroundColor, s.color]
  })
  expect(look).toEqual(['rgb(228, 240, 238)', 'rgb(31, 107, 102)'])
})

test('focused sidebar row shows its status tooltip', async ({ page }) => {
  await openScreen(page, 'step-mixed')
  await page.locator('nav [aria-label^="2 "]').focus()
  await expect(page.locator('nav [aria-label^="2 "] .tooltip__bubble')).toHaveText('vielleicht veraltet')
  // The bubble sits beside the sidebar, so the shot reaches into the main area.
  await page.screenshot({
    path: 'screenshots/gallery/sidebar-focus-tooltip.png',
    clip: { x: 0, y: 0, width: 440, height: 520 },
    animations: 'disabled',
  })
})

test('below 960 px the hint shows above the header', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await openScreen(page, 'step')
  await expect(page.getByText('Zieh das Fenster etwas breiter')).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-narrow.png', animations: 'disabled' })
})
