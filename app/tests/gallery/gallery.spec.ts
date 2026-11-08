import { expect, test, type Page } from '@playwright/test'
import { makeProject } from '../../src/domain/fixtures'
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
  const width = (await button.boundingBox())!.width
  await button.dblclick()
  await expect(button).toHaveAccessibleName('prüft …')
  await expect(button).toHaveAttribute('aria-busy', 'true')
  // The wider label keeps its space: the button doesn't resize while busy.
  expect((await button.boundingBox())!.width).toBe(width)
  await expect(button).toHaveAccessibleName('Prüfen und bestätigen', { timeout: 4000 })
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

const chatScreens = [
  'chat-empty',
  'chat',
  'chat-thinking',
  'chat-streaming',
  'chat-aborted',
  'chat-key-error',
  'chat-failed',
  'chat-no-answer',
  'chat-draft',
  'chat-intro',
  'chat-session',
  'chat-back',
  'chat-summarising',
  'chat-segment',
  'chat-segment-none',
  'chat-long-streaming',
]
const screenNames = [
  ...chatScreens,
  'block-empty',
  'block',
  'proposal',
  'proposal-opening',
  'check-unchecked',
  'check-busy',
  'check-blocked',
  'check-ready',
  'check-ready-clean',
  'check-changed',
  'check-confirmed',
  'check-failed',
  'check-chat-busy',
  'home',
  'home-mixed',
  'home-backup-recent',
  'home-backup-due',
  'home-backup-never',
  'step',
  'step-mixed',
  'settings',
  'settings-filled',
  'saved',
  'save-failed',
  'save-failed-step',
]
// Without the app frame (no navigation).
const setupScreens = [
  'setup-welcome',
  'setup-key',
  'setup-key-ok',
  'setup-key-error',
  'setup-key-offline',
  'setup-privacy',
  'setup-backup',
  'setup-backup-done',
  'setup-key-only',
]
const bareScreens = ['skeleton', 'empty', 'empty-error', 'second-tab', 'load-invalid', 'load-newer', 'load-storage', ...setupScreens]

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

test('backup reminder: ⚠ banner between card and steps; the sidebar line turns ⚠', async ({ page }) => {
  await openScreen(page, 'home-backup-due')
  const reminder = page.locator('.home .banner--warn')
  await expect(reminder).toContainText('Dein letztes Backup ist 9 Tage alt.')
  const [card, banner, part] = await Promise.all([
    page.locator('.home__resume').boundingBox(),
    reminder.boundingBox(),
    page.locator('.home__part').first().boundingBox(),
  ])
  expect(card && banner && part && card.y + card.height < banner.y && banner.y + banner.height < part.y).toBe(true)
  await expect(page.locator('nav [data-slot="backup-status"]')).toHaveText('Backup: vor 9 Tagen')
  await shot(page.locator('nav'), 'sidebar-backup-due')

  await page.getByRole('button', { name: 'Backup speichern' }).click()
  await expect(page.getByText('Backup ist in deinen Downloads.')).toBeFocused()
  await page.screenshot({ path: 'screenshots/gallery/screen-home-backup-saved.png', animations: 'disabled' })
})

test('settings: key error at the field, remove and restore dialogs, load dialog, unusable file', async ({ page }) => {
  await openScreen(page, 'settings')
  await page.getByLabel('API-Schlüssel').fill('zu-kurz')
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(page.getByText(/nicht wie ein vollständiger API-Schlüssel/)).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-settings-key-error.png', animations: 'disabled' })

  await openScreen(page, 'settings-filled')
  await page.getByRole('button', { name: 'entfernen' }).click()
  await expect(page.getByRole('dialog', { name: 'API-Schlüssel entfernen?' })).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-settings-remove-key.png', animations: 'disabled' })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Vorherige Version wiederherstellen' }).click()
  await expect(page.getByRole('dialog', { name: 'Vorherige Version wiederherstellen?' })).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-settings-restore.png', animations: 'disabled' })
  await page.keyboard.press('Escape')

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Backup laden' }).click()
  await (await chooser).setFiles({
    name: 'wirkungshelferin-backup-2026-11-03.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...makeProject(), lastBackupAt: '2026-11-03T10:00:00.000Z' })),
  })
  await expect(page.getByRole('dialog', { name: 'Backup laden?' })).toContainText('vom 3. November 2026')
  await page.screenshot({ path: 'screenshots/gallery/screen-settings-load-dialog.png', animations: 'disabled' })
  await page.keyboard.press('Escape')

  const again = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Backup laden' }).click()
  await (await again).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"kein":"backup"}') })
  await expect(page.getByText(/kein Backup der Wirkungshelferin/)).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-settings-load-error.png', animations: 'disabled' })
})

test('settings: inputs are 32 px high like the buttons beside them', async ({ page }) => {
  await openScreen(page, 'settings')
  const [input, button] = await Promise.all([
    page.getByLabel('API-Schlüssel').boundingBox(),
    page.getByRole('button', { name: 'Speichern', exact: true }).boundingBox(),
  ])
  expect(input?.height).toBe(32)
  expect(button?.height).toBe(32)
  expect(Math.abs(input!.y - button!.y)).toBeLessThan(1)
})


test('setup: testing the key (busy, then success) and the settings test', async ({ page }) => {
  const errors = watchErrors(page)
  await openScreen(page, 'setup-key')
  await page.getByLabel('API-Schlüssel').fill('gallery-dummy-key-not-real-7f3a')
  // The key is drawn as dots, not as a password field.
  await expect(page.getByLabel('API-Schlüssel')).toHaveCSS('-webkit-text-security', 'disc')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.getByRole('button', { name: 'Teste …' })).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-setup-key-testing.png', animations: 'disabled' })
  await expect(page.getByText(/Verbindung erfolgreich/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Weiter', exact: true })).not.toHaveAttribute('aria-disabled')
  await page.screenshot({ path: 'screenshots/gallery/screen-setup-key-tested.png', animations: 'disabled' })

  await openScreen(page, 'settings-filled')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.getByText('Verbindung erfolgreich.')).toBeVisible()
  await page.screenshot({ path: 'screenshots/gallery/screen-settings-connection-ok.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('chat states: one Stopp while streaming, errors as alerts in the chat, the composer focus ring', async ({ page }) => {
  await openScreen(page, 'chat-streaming')
  await expect(page.getByRole('button', { name: 'Stopp' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Senden' })).toHaveCount(0)
  await openScreen(page, 'chat-thinking')
  await expect(page.locator('.chat__log').getByText('denkt nach …')).toBeVisible()
  await openScreen(page, 'chat-key-error')
  const alert = page.locator('.chat__log').getByRole('alert')
  await expect(alert).toContainText('Dein API-Schlüssel funktioniert nicht mehr.')
  await expect(alert.getByRole('button', { name: 'Zu den Einstellungen' })).toBeVisible()
  await openScreen(page, 'chat-aborted')
  await expect(page.locator('.msg__aborted')).toHaveText('abgebrochen')
  // The newest message is in view: the chat opens at the bottom.
  await expect(page.locator('.msg').last()).toBeInViewport()
  await page.getByRole('textbox', { name: 'Deine Nachricht' }).focus()
  const outline = await page.locator('.composer').evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).toBe('solid')
  await page.screenshot({ path: 'screenshots/gallery/screen-chat-focus.png', animations: 'disabled' })
  // Lukas scrolled up: the long conversation keeps its own scroll, the composer stays put.
  await openScreen(page, 'chat')
  const composer = await page.locator('.composer').boundingBox()
  expect(composer && composer.y + composer.height).toBeLessThanOrEqual(860)
})

test('chat step 10: intro, term tooltip, dividers, summary, "Zur neuesten Nachricht"', async ({ page }) => {
  const log = page.locator('.chat__log')
  const shot = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })

  // Collapsed intro is one line above the messages.
  await openScreen(page, 'chat')
  const toggle = page.getByRole('button', { name: 'Worum geht es?' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect((await page.locator('.intro').boundingBox())!.height).toBeLessThanOrEqual(46)

  // Open on a first visit; a term opens by keyboard and the bubble stays inside the window.
  await openScreen(page, 'chat-intro')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveText('direkte/indirekte Zielgruppe')
  await page.keyboard.press('Enter')
  const bubble = page.getByRole('tooltip')
  await expect(bubble).toContainText('Indirekte Zielgruppe:')
  const box = (await bubble.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(1280)
  // Not clipped by the intro's own scroll box: the bubble is what sits at its centre.
  const onTop = await bubble.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  })
  expect(onTop).toBe(true)
  await shot('chat-term')
  await page.keyboard.press('Escape')
  await expect(bubble).toBeHidden()

  // "Letzte Sitzung" before the new activity, or last when nothing new came yet.
  await openScreen(page, 'chat-session')
  const items = log.locator('.chat__messages > li')
  const texts = await items.allTextContents()
  const divider = texts.findIndex((t) => t === 'Letzte Sitzung: 26.10.')
  expect(texts[divider + 1]).toBe('Meistens Jüngere, so 12 bis 14.')
  await openScreen(page, 'chat-back')
  await expect(items.last()).toHaveText('Letzte Sitzung: 26.10.')
  await expect(items.last()).toBeInViewport()

  // Summary of the old segment, one click away.
  await openScreen(page, 'chat-segment')
  await log.getByRole('button', { name: 'Zusammenfassung' }).click()
  await expect(log.getByText('Das Gespräch darüber kennt die Wirkungshelferin nur noch so:')).toBeVisible()
  await log.locator('.chat__divider--segment').scrollIntoViewIfNeeded()
  await shot('chat-segment-open')

  // Scrolled up while an answer streams: the jump button, which brings the newest back.
  await openScreen(page, 'chat-long-streaming')
  const jump = page.getByRole('button', { name: 'Zur neuesten Nachricht' })
  await expect(jump).toHaveCount(0)
  await log.evaluate((el) => el.scrollTo(0, 0))
  await expect(jump).toBeVisible()
  await shot('chat-jump')
  await jump.click()
  await expect(page.locator('.msg').last()).toBeInViewport()
  await expect(jump).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Deine Nachricht' })).toBeFocused()
})

test('block step 11: inline fields, "von dir geändert", undo line, dialog for a group with content', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const panel = page.getByRole('region', { name: 'Baustein' })
  // Colour checks: no 150 ms transition caught halfway (lessons-learned, step 2).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openScreen(page, 'block')
  const scroll = panel.locator('.workspace__scroll')
  // Nothing sticks out sideways in the block column.
  expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  // The field text lines up with the section heading; hover shows the pencil and the subtle background.
  const name = panel.getByRole('textbox', { name: 'Name der Zielgruppe' }).first()
  const heading = panel.getByRole('heading', { name: 'Zielgruppen' })
  const [textX, headingX] = await Promise.all([
    name.evaluate((el) => el.getBoundingClientRect().x + parseFloat(getComputedStyle(el).paddingLeft) + parseFloat(getComputedStyle(el).borderLeftWidth)),
    heading.evaluate((el) => el.getBoundingClientRect().x),
  ])
  expect(Math.abs(textX - headingX)).toBeLessThanOrEqual(1)
  const pencil = name.locator('xpath=..').locator('.inline__pencil')
  await name.hover()
  await expect(pencil).toBeVisible()
  const subtle = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface-subtle').trim())
  expect(await name.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await page.evaluate((c) => {
      const el = document.createElement('span')
      el.style.color = c
      document.body.append(el)
      const value = getComputedStyle(el).color
      el.remove()
      return value
    }, subtle),
  )
  await shotScreen('block-hover')

  // Editing: border + focus ring, Enter saves, the row says "von dir geändert".
  await name.click()
  expect(await name.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
  await expect(pencil).toBeHidden()
  await shotScreen('block-editing')
  await page.keyboard.press('End')
  await page.keyboard.type(' (Kern)')
  await page.keyboard.press('Enter')
  await expect(name).not.toBeFocused()
  await expect(panel.locator('[data-item-id="tg1"]').getByText('von dir geändert')).toBeVisible()

  // Click targets of the small controls are at least 32 px high.
  for (const target of [panel.getByRole('button', { name: /entfernen$/ }).first(), panel.locator('.bcontrol').first(), panel.getByRole('button', { name: 'Zielgruppe hinzufügen' })]) {
    const box = (await target.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(32)
    expect(box.width).toBeGreaterThanOrEqual(32)
  }

  // A group without content, by keyboard: removed at once, the undo line in its place with
  // focus and a visible focus ring.
  await panel.getByRole('button', { name: 'Zielgruppe „Eltern der Jugendlichen“ entfernen' }).focus()
  await page.keyboard.press('Enter')
  const undo = panel.getByRole('button', { name: 'Rückgängig' })
  await expect(undo).toBeFocused()
  expect(await undo.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
  await shotScreen('block-undo')
  await page.keyboard.press('Enter')
  await expect(panel.locator('[data-item-id="tg2"]')).toBeVisible()

  // The focus group has content in step 2: a dialog first; Esc keeps everything.
  await panel.getByRole('button', { name: /^Zielgruppe „Jugendliche 12–17.*entfernen$/ }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('In Schritt 2 gibt es schon 2 Einträge zu dieser Gruppe.')
  const cancel = dialog.getByRole('button', { name: 'Abbrechen' })
  await expect(cancel).toBeFocused()
  expect(await cancel.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
  // Three actions, one per line, all inside the dialog.
  const dialogBox = (await dialog.boundingBox())!
  for (const button of await dialog.locator('.dialog__actions .btn').all()) {
    const box = (await button.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(dialogBox.x)
    expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width)
  }
  await shotScreen('block-dialog')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(panel.locator('[data-item-id="tg1"]')).toBeVisible()

  await openScreen(page, 'block-empty')
  await panel.getByRole('button', { name: 'Zielgruppe hinzufügen' }).click()
  await expect(panel.getByRole('textbox', { name: 'Name der Zielgruppe' })).toBeFocused()
  await shotScreen('block-added')
})

test('block parts: states for the review', async ({ page }) => {
  await openGallery(page)
  await shot(section(page, 'Baustein-Teile'), 'block-parts')
})

test('proposals step 12: every row state, hover outline, apply highlight, jump, ~330 px chat column', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  // Highlight colours are checked while they stand still (lessons-learned, step 2).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openScreen(page, 'proposal')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  const block = page.getByRole('region', { name: 'Baustein' })
  const log = page.locator('.chat__log')
  const fitsSideways = () => log.evaluate((el) => el.scrollWidth <= el.clientWidth)
  // A card taller than the chat column is clipped by its scroll box: shoot it in a tall window.
  const cardShot = async (name: string) => {
    const size = page.viewportSize()!
    await page.setViewportSize({ width: size.width, height: 2400 })
    await card.scrollIntoViewIfNeeded()
    await shot(card, name)
    await page.setViewportSize(size)
  }
  expect(await fitsSideways()).toBe(true)
  await expect(card.getByText('Veraltet')).toBeVisible()
  await expect(card.getByText('du hast das inzwischen geändert')).toBeVisible()
  await expect(card.getByText('zuerst ‚Neu: Stammgäste 12–14‘ übernehmen')).toBeVisible()
  await expect(card.getByText('abgelehnt')).toBeVisible()
  await expect(card.getByText('übernommen', { exact: true })).toBeVisible()
  await cardShot('proposal-card')

  // Hover a row → its item is outlined in the block (and visible there).
  await card.getByRole('button', { name: /^Übernehmen: Ändern – Zielgruppe „Eltern/ }).hover()
  const parents = block.locator('[data-item-id="tg2"]')
  await expect(parents).toHaveAttribute('data-outlined', '')
  expect(await parents.evaluate((el) => getComputedStyle(el, '::before').boxShadow)).toContain('inset')
  await shotScreen('proposal-hover')
  // Leaving the row for the block (click, type, Enter) takes the outline away.
  const why = parents.getByLabel('Warum?')
  await why.click()
  await page.keyboard.type(' (Test)')
  await page.keyboard.press('Enter')
  await expect(block.locator('[data-outlined]')).toHaveCount(0)

  // Übernehmen → the item scrolls into view in the block and lights up (still, under reduced motion).
  await page.mouse.move(0, 0)
  await card.getByRole('button', { name: 'Übernehmen: Neu – Zielgruppe „Stammgäste 12–14“' }).click()
  const added = block.locator('[data-item-id="tg3"]')
  await expect(added).toHaveAttribute('data-highlight', '')
  await expect(added).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  const soft = await page.evaluate(() => {
    const el = document.createElement('span')
    el.style.color = 'var(--accent-soft)'
    document.body.append(el)
    const value = getComputedStyle(el).color
    el.remove()
    return value
  })
  expect(await added.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)).toBe(soft)
  // The dependent row is open now; focus sits on the applied row's Rückgängig.
  await expect(card.getByRole('button', { name: /^Übernehmen: Ändern – Zielgruppe „Stammgäste 12–14“/ })).not.toHaveAttribute('aria-disabled')
  await expect(card.getByRole('button', { name: 'Rückgängig: Neu – Zielgruppe „Stammgäste 12–14“' })).toBeFocused()
  await shotScreen('proposal-applied')
  await expect(added).not.toHaveAttribute('data-highlight', '', { timeout: 3_000 })

  // Details of a NEU row.
  await openScreen(page, 'proposal-opening')
  await card.getByRole('button', { name: 'Details' }).first().click()
  await cardShot('proposal-opening-card')

  // The jump line: chat scrolled away from the card → click → card in view, focused, lit.
  await log.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await block.getByRole('button', { name: '7 offene Änderungen im Chat' }).click()
  await expect(card).toBeFocused()
  await expect(card).toHaveAttribute('data-highlight', '')
  // The card is taller than the chat, but its first open row fits under the title: the card's
  // top lands at the top of the chat (not the card's end), the row fully in view.
  const firstOpen = card.locator('.prow--open').first()
  await expect
    .poll(async () => (await card.boundingBox())!.y - (await log.boundingBox())!.y)
    .toBeLessThan(40)
  await expect(firstOpen).toBeInViewport({ ratio: 1 })
  // Only the chat column scrolled, never the window.
  expect(await page.evaluate(() => [window.scrollY, document.scrollingElement!.scrollTop])).toEqual([0, 0])
  await shotScreen('proposal-jump')

  // ~330 px chat column (960 px window): nothing sideways, buttons inside the card.
  await page.setViewportSize({ width: 960, height: 860 })
  for (const name of ['proposal', 'proposal-opening']) {
    await openScreen(page, name)
    const width = await page.locator('.workspace__chat').evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeLessThan(345)
    expect(await fitsSideways()).toBe(true)
    const cardBox = (await card.boundingBox())!
    for (const button of await card.locator('.btn').all()) {
      const box = (await button.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x)
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
      expect(box.height).toBeGreaterThanOrEqual(32)
    }
    // The page itself never scrolls: nothing inside a column may stick out of the window.
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
    await shotScreen(`${name}-narrow`)
    await cardShot(`${name}-card-narrow`)
  }
  expect(errors).toEqual([])
})

test('quality gate step 13: A, busy, B, C, the question, confirmed + backup prompt, ≤ 50 % of the panel', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  /** The gate stays within half of the block column, its buttons in view, and the page never scrolls. */
  const fits = async () => {
    const column = (await page.locator('.workspace__block').boundingBox())!
    const area = (await gate.boundingBox())!
    expect(area.height).toBeLessThanOrEqual(column.height * 0.5 + 1)
    for (const button of await gate.locator('.gate__actions .btn').all()) await expect(button).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  }

  await openScreen(page, 'check-unchecked')
  await shotScreen('check-unchecked')
  await gate.getByRole('button', { name: 'Prüfen und bestätigen' }).click()
  await expect(gate.getByText('prüft …', { exact: true })).toBeVisible()
  // Code knows the ⛔ points at once (design §6.2): they show while Claude still checks.
  await expect(gate.getByRole('button', { name: /^Zum Feld: Warum fehlt: Zielgruppe „Eltern/ })).toBeVisible()
  await shotScreen('check-busy')
  // filled() leaves the parents' Why empty → B, focus on the first "Zum Feld".
  const toField = gate.getByRole('button', { name: /^Zum Feld: Warum fehlt: Zielgruppe „Eltern/ })
  await expect(toField).toBeFocused()
  await expect(page.locator('[data-item-id="tg2"] [data-field="why"]')).toContainText('fehlt')
  await fits()
  // The focus ring isn't clipped by the scrolling list (PO test 2026-11-08): the list's box
  // leaves room for ring + offset on every side of the button.
  const ring = await toField.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const l = el.closest('.gate__rows')!.getBoundingClientRect()
    return [b.left - l.left, l.right - b.right, b.top - l.top]
  })
  for (const room of ring) expect(room).toBeGreaterThanOrEqual(4)
  await shotScreen('check-blocked-after')
  await page.keyboard.press('Enter')
  const why = page.locator('[data-item-id="tg2"] [data-field="why"] textarea')
  await expect(why).toBeFocused()
  await expect(why).toBeInViewport()
  await shotScreen('check-to-field')

  await openScreen(page, 'check-blocked')
  await fits()
  await shotScreen('check-blocked')
  const okToggle = gate.getByRole('button', { name: '5 Punkte erfüllt' })
  await expect(okToggle).toBeInViewport({ ratio: 1 })
  await okToggle.click()
  // Opened, the first ✓ row is brought into view inside the list.
  await expect(gate.locator('.gate__row--ok').first()).toBeInViewport({ ratio: 0.95 })
  await fits()
  await shotScreen('check-blocked-ok-open')

  await openScreen(page, 'check-ready')
  await fits()
  await shotScreen('check-ready')
  await gate.getByRole('button', { name: 'Bestätigen' }).click()
  await expect(gate.getByRole('group', { name: 'Trotzdem bestätigen?' }).getByRole('button', { name: 'Bestätigen' })).toBeFocused()
  await fits()
  await shotScreen('check-asking')
  await page.keyboard.press('Enter')
  await expect(gate.getByRole('button', { name: 'Backup speichern' })).toBeFocused()
  await expect(page.getByRole('button', { name: '1 Gruppen, bestätigt' })).toBeVisible()
  await fits()
  await shotScreen('check-confirmed-prompt')

  for (const name of ['check-ready-clean', 'check-changed', 'check-confirmed', 'check-failed', 'check-chat-busy']) {
    await openScreen(page, name)
    await fits()
    await shotScreen(name)
  }

  // 960 px window: the narrowest workspace.
  await page.setViewportSize({ width: 960, height: 760 })
  for (const name of ['check-blocked', 'check-ready']) {
    await openScreen(page, name)
    await fits()
    await shotScreen(`${name}-narrow`)
  }
  // At 960 × 760 the blocked list is cut off at the bottom → the 1 px line; scrolled to the end → gone.
  await openScreen(page, 'check-blocked')
  const rows = gate.locator('.gate__rows')
  await expect(rows).toHaveAttribute('data-cut', '')
  await rows.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await expect(rows).not.toHaveAttribute('data-cut')
  expect(errors).toEqual([])
})
