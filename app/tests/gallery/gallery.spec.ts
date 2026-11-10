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
  'step0-empty',
  'step0-draft',
  'step0-profile',
  'step0-change',
  'step0-check',
  'step0-ready',
  'step0-pdf-failed',
  'step0-pdf-partial',
  'step0-pdf-draft',
  'step1-handoff',
  'step2',
  'step2-empty',
  'step2-nofocus',
  'step2-hidden',
  'step2-blocked',
  'step2-proposal',
  'step3',
  'step3-empty',
  'step3-nofocus',
  'step3-blocked',
  'step3-proposal',
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

test('step 0 (step 14): start panel, paste form, first draft, form states, field outline, check, hand-off', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const block = page.getByRole('region', { name: 'Baustein' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const log = page.locator('.chat__log')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  /** The block column in a tall window, so the whole form is in one shot. */
  const blockShot = async (name: string) => {
    const size = page.viewportSize()!
    await page.setViewportSize({ width: size.width, height: 2600 })
    await shot(page.locator('.workspace__block'), name)
    await page.setViewportSize(size)
  }

  // Empty: start panel, no "als offen markieren" yet, the lead line.
  await openScreen(page, 'step0-empty')
  await expect(page.getByText('Wie willst du anfangen?')).toBeVisible()
  await expect(block.getByRole('button', { name: /als offen markieren$/ })).toHaveCount(0)
  await expect(block.getByText(/Lade links ein PDF hoch, füge einen Text ein/)).toBeVisible()
  await noPageScroll()
  await shotScreen('step0-empty')
  await blockShot('step0-empty-block')

  // Paste form: replaces the composer, the intro folds, at least 120 px of chat stay visible.
  await page.locator('.start').getByRole('button', { name: 'Text einfügen' }).click()
  const form = page.getByRole('form', { name: 'Text einfügen' })
  await expect(form.getByLabel('Text')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Worum geht es?' })).toHaveAttribute('aria-expanded', 'false')
  await form.getByLabel('Bezeichnung').fill('Projektskizze Schraubzeit 2026')
  await form.getByLabel('Text').fill('Projektskizze „Schraubzeit“\n\n'.repeat(40))
  expect((await log.boundingBox())!.height).toBeGreaterThanOrEqual(120)
  for (const button of await form.locator('.btn').all()) await expect(button).toBeInViewport({ ratio: 1 })
  await noPageScroll()
  await shotScreen('step0-paste')

  // First draft: one NEU row, fields listed and cut to 2 lines; hover outlines the whole profile.
  await openScreen(page, 'step0-draft')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card.getByText('Projektprofil')).toBeVisible()
  await expect(card.locator('.offen-chip').first()).toBeVisible()
  const line = page.locator('.chat__act-text').first()
  await expect(line).toContainText('Text eingefügt: „Projektskizze Schraubzeit 2026“')
  // One line, never wrapped (UI/UX review): a cut label shows an ellipsis instead.
  expect((await line.boundingBox())!.height).toBeLessThanOrEqual(24)
  const apply = card.getByRole('button', { name: 'Übernehmen: Neu – Projektprofil' })
  // "Details" ends the button line and opens the full values (UI/UX re-review).
  const details = card.getByRole('button', { name: 'Details' })
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await details.click()
  await apply.hover()
  await expect(block.locator('[data-item-id="profile"]')).toHaveAttribute('data-outlined', '')
  await noPageScroll()
  await shotScreen('step0-draft')
  await apply.click()
  await expect(block.locator('[data-item-id="profile"]')).toHaveAttribute('data-highlight', '')
  await expect(block.getByRole('button', { name: /^Team/ })).toBeVisible()
  await shotScreen('step0-draft-applied')

  // Profile: chips, leer fields with their button, the source.
  await openScreen(page, 'step0-profile')
  await expect(block.getByRole('button', { name: 'Laufzeit als offen markieren' })).toBeVisible()
  await expect(block.locator('.offen-chip')).not.toHaveCount(0)
  await block.getByRole('button', { name: 'Text ansehen' }).click()
  const text = block.locator('.bsource__text')
  await text.focus()
  // Room for the focus ring inside the panel (lessons-learned, step 13).
  const room = await text.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const p = el.closest('.workspace__scroll')!.getBoundingClientRect()
    return [b.left - p.left, p.right - b.right]
  })
  for (const r of room) expect(r).toBeGreaterThanOrEqual(4)
  await shotScreen('step0-profile')
  await blockShot('step0-profile-block')

  // A change once the profile has content: only the changed fields are outlined, then highlighted.
  await openScreen(page, 'step0-change')
  const change = page.getByRole('article', { name: 'Vorschlag' }).last()
  const row = change.getByRole('button', { name: 'Übernehmen: Ändern – Projektprofil' })
  await row.hover()
  await expect(block.locator('[data-field="participants"]')).toHaveAttribute('data-outlined', '')
  await expect(block.locator('[data-field="duration"]')).toHaveAttribute('data-outlined', '')
  await expect(block.locator('[data-item-id="profile"]')).not.toHaveAttribute('data-outlined')
  await expect(block.locator('[data-field="name"]')).not.toHaveAttribute('data-outlined')
  await shotScreen('step0-change')
  await row.click()
  await expect(block.locator('[data-field="participants"]')).toHaveAttribute('data-highlight', '')
  await expect(block.locator('[data-item-id="profile"]')).not.toHaveAttribute('data-highlight')

  // Check: the app's ⚠ with "Zum Feld" → the first leer field.
  await openScreen(page, 'step0-check')
  await expect(gate.getByText('Noch leer, nicht als offen markiert: Laufzeit')).toBeVisible()
  await shotScreen('step0-check')
  await gate.getByRole('button', { name: /^Zum Feld/ }).click()
  const laufzeit = block.getByRole('textbox', { name: 'Laufzeit' })
  await expect(laufzeit).toBeFocused()
  await expect(laufzeit).toBeInViewport()

  // Hand-off: confirm → banner "schreibt …" with focus on Weiter → "fertig" → step 1.
  await openScreen(page, 'step0-ready')
  await gate.getByRole('button', { name: 'Bestätigen' }).click()
  const next = gate.getByRole('button', { name: 'Weiter zu Schritt 1' })
  await expect(next).toBeFocused()
  await expect(gate.getByText(/schreibt den ersten Entwurf für Schritt 1/)).toBeVisible()
  await noPageScroll()
  await shotScreen('step0-handoff-writing')
  await expect(gate.getByText('Schritt 0 bestätigt. Der erste Entwurf für Schritt 1 ist fertig.')).toBeVisible()
  await shotScreen('step0-handoff-done')
  await next.click()
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await expect(page.getByText('Schritt 0 bestätigt', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Worum geht es?' })).toHaveAttribute('aria-expanded', 'true')

  await openScreen(page, 'step1-handoff')
  await expect(page.getByRole('article', { name: 'Vorschlag' })).toBeVisible()
  await expect(page.getByRole('button', { name: /offene Änderungen im Chat/ })).toBeVisible()
  await shotScreen('step1-handoff')

  // 960 px: the narrowest workspace.
  await page.setViewportSize({ width: 960, height: 760 })
  for (const name of ['step0-empty', 'step0-draft', 'step0-change']) {
    await openScreen(page, name)
    // The start panel is the one next action: shown from its top, not scrolled away.
    if (name === 'step0-empty') await expect(page.getByText('Wie willst du anfangen?')).toBeInViewport()
    expect(await log.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await noPageScroll()
    await shotScreen(`${name}-narrow`)
  }
  expect(errors).toEqual([])
})

test('PDF upload (step 15): start panel, reading, failures, too long, after the draft, the later buttons', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const block = page.getByRole('region', { name: 'Baustein' })
  const log = page.locator('.chat__log')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  const pdf = { name: 'Projektantrag Schraubzeit 2026.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') }

  for (const [width, height, suffix] of [[1280, 860, ''], [1390, 880, '-1390'], [960, 760, '-narrow']] as const) {
    await page.setViewportSize({ width, height })

    // The start panel: PDF first, all three options and their buttons in view.
    await openScreen(page, 'step0-empty')
    const options = page.locator('.start__option')
    await expect(options).toHaveCount(3)
    await expect(options.first().getByRole('button', { name: 'PDF hochladen' })).toBeVisible()
    await expect(block.getByText('Noch keine Quelle – lade deinen Antrag als PDF hoch oder füge einen Text ein.')).toBeVisible()
    await noPageScroll()
    await shotScreen(`step0-pdf-start${suffix}`)

    // Reading: the panel at the end of the log, the start panel gone, Stopp in view.
    await page.locator('.start [data-pdf-input]').setInputFiles(pdf)
    await expect(page.getByText('„Projektantrag Schraubzeit 2026“ wird gelesen …')).toBeVisible()
    await expect(page.getByText('12.400 Zeichen gelesen')).toBeVisible()
    await expect(page.locator('.start')).toHaveCount(0)
    // The panel needs the room: the intro folds, like for the paste form.
    await expect(page.getByRole('button', { name: 'Worum geht es?' })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('button', { name: 'Stopp' })).toBeInViewport({ ratio: 1 })
    // Why sending waits, right above the composer (UI/UX review, step 15).
    await expect(page.locator('.chat__wait')).toHaveText('Warte, bis das PDF gelesen ist.')
    expect(await log.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await noPageScroll()
    await shotScreen(`step0-pdf-reading${suffix}`)
    await page.getByRole('button', { name: 'Stopp' }).click()
    await expect(page.getByLabel('Deine Nachricht')).toBeFocused()
    await expect(page.getByText('Wie willst du anfangen?')).toBeVisible()

    // A file that isn't a PDF: the reason, "Anderes PDF wählen", "Text einfügen".
    await page.locator('.start [data-pdf-input]').setInputFiles({ ...pdf, name: 'Antrag (Scan vom 12.03.).pdf', buffer: Buffer.from('kein PDF') })
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('ist keine echte PDF-Datei')
    await page.mouse.move(0, 0)
    for (const button of await alert.locator('.btn').all()) await expect(button).toBeInViewport({ ratio: 1 })
    await shotScreen(`step0-pdf-file-problem${suffix}`)

    // The API couldn't read it: "Erneut versuchen".
    await openScreen(page, 'step0-pdf-failed')
    await page.locator('.start [data-pdf-input]').setInputFiles(pdf)
    await expect(page.getByRole('alert')).toContainText('vielleicht ist es geschützt')
    await expect(page.getByRole('alert').getByRole('button', { name: 'Erneut versuchen' })).toBeInViewport({ ratio: 1 })
    await shotScreen(`step0-pdf-failed${suffix}`)

    // Too long: the paste form with the note, the text and the file's name.
    await openScreen(page, 'step0-pdf-partial')
    await page.locator('.start [data-pdf-input]').setInputFiles(pdf)
    const form = page.getByRole('form', { name: 'Text einfügen' })
    await expect(form.getByText(/Das PDF war zu lang/)).toBeVisible()
    await expect(form.getByLabel('Bezeichnung')).toHaveValue('Projektantrag Schraubzeit 2026')
    expect((await log.boundingBox())!.height).toBeGreaterThanOrEqual(120)
    for (const button of await form.locator('.btn').all()) await expect(button).toBeInViewport({ ratio: 1 })
    await noPageScroll()
    await shotScreen(`step0-pdf-partial${suffix}`)

    // After a PDF: the app line, the source's meta, both buttons above the composer and in Quellen.
    await openScreen(page, 'step0-pdf-draft')
    const line = page.locator('.chat__act-text').first()
    await expect(line).toContainText('PDF gelesen: „Projektantrag Schraubzeit 2026“')
    expect((await line.boundingBox())!.height).toBeLessThanOrEqual(24)
    const pasteLine = page.locator('.chat__paste-line')
    await expect(pasteLine.getByRole('button', { name: 'PDF hochladen' })).toBeVisible()
    await expect(pasteLine.getByRole('button', { name: 'Text einfügen' })).toBeVisible()
    expect((await pasteLine.boundingBox())!.height).toBeLessThanOrEqual(40)
    await expect(block.getByText(/^aus PDF am /)).toBeVisible()
    await block.getByRole('button', { name: 'PDF hochladen' }).scrollIntoViewIfNeeded()
    await expect(block.getByRole('button', { name: 'Text einfügen' })).toBeVisible()
    await noPageScroll()
    await shotScreen(`step0-pdf-draft${suffix}`)
    // The start of the turn: the app line with its icon (UI/UX review, step 15).
    await log.evaluate((el) => (el.scrollTop = 0))
    await shotScreen(`step0-pdf-draft-top${suffix}`)
  }
  expect(errors).toEqual([])
})

test('step 2 (step 16): groups, sticky header, tree, collapse, edge states, check into a collapsed group, card', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const block = page.getByRole('region', { name: 'Baustein' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const column = page.locator('.workspace__block .workspace__scroll')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'

    await openScreen(page, 'step2')
    await expect(page.locator('[data-group-toggle="tg1"]')).toHaveAttribute('aria-expanded', 'true')
    await noPageScroll()
    await shotScreen(`step2${suffix}`)

    // Scrolled into the first group: its header sticks at the top of the column with a line under it.
    await column.evaluate((el) => (el.scrollTop = 700))
    await page.waitForTimeout(50)
    const head = page.locator('[data-group-header="tg1"]')
    await expect(head).toHaveAttribute('data-stuck', '')
    expect(await column.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    const colBox = (await column.boundingBox())!
    const headBox = (await head.boundingBox())!
    expect(Math.abs(headBox.y - colBox.y)).toBeLessThanOrEqual(1)
    expect(headBox.height).toBeLessThanOrEqual(41)
    // Rows at 48 px indent still fit; "+ Ursache dafür" never overflows the column.
    for (const btn of await block.getByRole('button', { name: /^Ursache dafür hinzufügen/ }).all()) {
      const b = (await btn.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(colBox.x + colBox.width)
    }
    await shotScreen(`step2-stuck${suffix}`)

    // Collapsed: one summary line, the next group follows.
    await column.evaluate((el) => (el.scrollTop = 0))
    await page.locator('[data-group-toggle="tg1"]').click()
    await expect(block.getByText('Kernproblem · 4 Ursachen · 2 Folgen')).toBeVisible()
    await shotScreen(`step2-collapsed${suffix}`)
  }
  await page.setViewportSize({ width: 1390, height: 880 })

  // State B: ⛔ rows name the group; Zum Feld into a collapsed group opens it and the field is visible below the header.
  await openScreen(page, 'step2-blocked')
  await expect(gate.getByText(/Warum fehlt: Ursache „Reparaturen im Fahrradladen/)).toBeVisible()
  await page.locator('[data-group-toggle="tg1"]').click()
  await expect(block.getByText(/2 blockieren|1 blockiert/)).toBeVisible()
  await shotScreen('step2-blocked-collapsed')
  await gate.getByRole('button', { name: /^Zum Feld: Warum fehlt: Ursache/ }).click()
  const target = page.locator('[data-item-id="ca2"] [data-field="why"] textarea')
  await expect(target).toBeFocused()
  await page.waitForTimeout(400)
  const t = (await target.boundingBox())!
  const c = (await column.boundingBox())!
  const stuck = (await page.locator('[data-group-header="tg1"]').boundingBox())!
  expect(t.y).toBeGreaterThanOrEqual(Math.max(c.y, stuck.y + stuck.height) - 1)
  expect(t.y + t.height).toBeLessThanOrEqual(c.y + c.height + 1)
  await noPageScroll()
  await shotScreen('step2-blocked-field')
  // The field sits right under the stuck header: Zum Feld moves it out from under it (scroll padding).
  await column.evaluate((el, y) => (el.scrollTop += y), t.y - c.y - 10)
  await page.waitForTimeout(50)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await gate.getByRole('button', { name: /^Zum Feld: Warum fehlt: Ursache/ }).click()
  await page.waitForTimeout(400)
  const t2 = (await target.boundingBox())!
  const head2 = (await page.locator('[data-group-header="tg1"]').boundingBox())!
  expect(t2.y).toBeGreaterThanOrEqual(head2.y + head2.height - 1)

  // The card: group in the noun line, evidence + parent on NEU, placement on ÄNDERN, moved children on ENTFERNEN.
  await openScreen(page, 'step2-proposal')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card.getByText('Ursache · Jugendliche 12–17 aus der Siedlung')).toHaveCount(2)
  await expect(card.getByText(/unsicher · nicht beeinflussbar · unter „Kaum Erwachsene/)).toBeVisible()
  await expect(card.getByText('1 Folge darunter rückt eine Ebene hoch')).toBeVisible()
  // Hover on a row of a collapsed group outlines the header, nothing opens.
  await page.locator('[data-group-toggle="tg1"]').click()
  await card.locator('[data-change-id="p1c2"]').hover()
  await expect(page.locator('[data-group-header="tg1"]')).toHaveAttribute('data-outlined', '')
  await expect(page.locator('[data-group-toggle="tg1"]')).toHaveAttribute('aria-expanded', 'false')
  await shotScreen('step2-proposal-hover-collapsed')
  await page.mouse.move(0, 0)
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = 0))
  await shotScreen('step2-proposal')

  for (const name of ['step2-empty', 'step2-nofocus', 'step2-hidden']) {
    await openScreen(page, name)
    await noPageScroll()
    await shotScreen(name)
  }
  await openScreen(page, 'step2-hidden')
  await page.locator('[data-group-toggle="tg1"]').click()
  await expect(block.getByText(/1 Ursache ist ausgeblendet, solange „Mädchen 11–14 aus der Siedlung“/)).toBeVisible()
  await shotScreen('step2-hidden-line')
  expect(errors).toEqual([])
})

test('step 3 (step 17): levels, marks, picker, non-focus groups, Stufe 7, check, card, step link', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const block = page.getByRole('region', { name: 'Baustein' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const column = page.locator('.workspace__block .workspace__scroll')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'
    await openScreen(page, 'step3')
    await noPageScroll()
    await shotScreen(`step3${suffix}`)
    // Nothing sticks out of the column: chips, the picker button, the time field.
    const colBox = (await column.boundingBox())!
    for (const el of await block.locator('.bgoal__controls').all()) {
      const b = (await el.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(colBox.x + colBox.width)
    }
    await column.evaluate((el) => (el.scrollTop = 900))
    await page.waitForTimeout(50)
    await shotScreen(`step3-mid${suffix}`)
    // A stuck header (one-line name) and a disabled "+ Ziel" reason never make the column scroll sideways (step 17).
    expect(await column.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await column.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.waitForTimeout(50)
    await shotScreen(`step3-end${suffix}`)
  }
  await page.setViewportSize({ width: 1390, height: 880 })

  // The cause picker: opens in place, focus on the first box, ticking links live, Esc closes back to the button.
  await openScreen(page, 'step3')
  const toggle = page.locator('[data-picker-toggle="go2"]')
  await toggle.click()
  const picker = page.locator('[data-picker="go2"]')
  await expect(picker.getByRole('checkbox').first()).toBeFocused()
  await expect(picker.getByRole('checkbox', { name: /Kaum Erwachsene/ })).toBeChecked()
  await expect(picker.getByText(' · nicht beeinflussbar')).toBeVisible()
  await picker.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await shotScreen('step3-picker')
  await picker.getByRole('checkbox', { name: /Kaum Erwachsene/ }).uncheck()
  await expect(page.locator('[data-item-id="go2"] .bgoal__causes .refchip')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(toggle).toBeFocused()
  // The broken link: ⚠ chip, and in the picker a checked "Verweis fehlt" box that removes it.
  await expect(page.locator('[data-item-id="go4"]').getByText('Verweis fehlt')).toBeVisible()
  await page.locator('[data-picker-toggle="go4"]').click()
  await page.locator('[data-picker="go4"]').getByRole('checkbox', { name: /Verweis fehlt/ }).click()
  await expect(page.locator('[data-item-id="go4"] .refchip--missing')).toHaveCount(0)

  // Check: ⛔ rows per group, ⚠ from the app (time frame); Zum Feld on "Stufe 4 ist leer" focuses that level's "+ Ziel".
  await openScreen(page, 'step3-blocked')
  await expect(gate.getByText('Stufe 4 ist leer · Mädchen 11–14 aus der Siedlung')).toBeVisible()
  await expect(gate.getByText('Kein Ziel · Nachbarinnen und Nachbarn')).toBeVisible()
  await expect(gate.getByText('Warum fehlt: Stufe 7')).toBeVisible()
  await shotScreen('step3-blocked')
  await page.locator('[data-group-toggle="tg3"]').click()
  await gate.getByRole('button', { name: /^Zum Feld: Stufe 4 ist leer/ }).click()
  await expect(page.locator('[data-add="goals-tg3-4"]')).toBeFocused()
  await expect(page.locator('[data-group-toggle="tg3"]')).toHaveAttribute('aria-expanded', 'true')
  await noPageScroll()

  // "Trifft für diese Gruppe nicht zu": the mark appears, its Why gets focus, "+ Ziel" says why it can't be used.
  await block.getByRole('button', { name: 'Stufe 4 trifft für „Mädchen 11–14 aus der Siedlung“ nicht zu' }).click()
  await expect(page.locator('[data-item-id="na2"] [data-field="why"] textarea')).toBeFocused()
  await expect(page.locator('[data-add="goals-tg3-4"]')).toHaveAttribute('aria-disabled', 'true')
  await shotScreen('step3-marked')

  // The card: level in the noun, links on the meta line, a goal waiting for the mark's removal; "Zu Schritt 2" opens step 2.
  await openScreen(page, 'step3-proposal')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card.getByText('Ziel · Stufe 4 · Mädchen 11–14 aus der Siedlung')).toBeVisible()
  await expect(card.getByText(/bis zum Sommer · löst auf: „Werkstätten gelten/)).toBeVisible()
  await expect(card.getByText('zuerst „Entfernen: Trifft nicht zu · Stufe 6“ übernehmen')).toBeVisible()
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = 0))
  await shotScreen('step3-proposal')
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shotScreen('step3-proposal-end')
  await page.getByRole('button', { name: 'Zu Schritt 2' }).first().click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Problem')

  for (const name of ['step3-empty', 'step3-nofocus']) {
    await openScreen(page, name)
    await noPageScroll()
    await shotScreen(name)
  }
  expect(errors).toEqual([])
})

test('step 4 (step 18): chain per group, goals read-only, link picker, critical warning, check, card', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const column = page.locator('.workspace__block .workspace__scroll')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  const noSideScroll = async () => expect(await column.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'
    await openScreen(page, 'step4')
    await noPageScroll()
    await noSideScroll()
    await shotScreen(`step4${suffix}`)
    // Through the youth chain (stuck header), the girls' chain, Umfeld at the end.
    for (const [i, top] of [1100, 2000, 3000].entries()) {
      await column.evaluate((el, y) => (el.scrollTop = y), top)
      await page.waitForTimeout(50)
      await noSideScroll()
      await shotScreen(`step4-${i + 1}${suffix}`)
    }
    await column.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await page.waitForTimeout(50)
    await noSideScroll()
    await shotScreen(`step4-end${suffix}`)
  }
  await page.setViewportSize({ width: 1390, height: 880 })

  // A link row: two lines, the arrow; the deleted end and the level jump read as such.
  await openScreen(page, 'step4')
  await expect(page.locator('[data-item-id="li9"] .refchip--missing')).toBeVisible()
  await expect(page.locator('[data-item-id="li8"]').getByText('überspringt Stufe 2', { exact: true })).toBeVisible()
  await expect(page.locator('[data-item-id="ac3"]').getByText('Noch in keiner Kette')).toBeVisible()

  // The picker: in place, focus on the first radio, a draft until Fertig, Esc keeps the old ends.
  const toggle = page.locator('[data-picker-toggle="li2"]')
  await toggle.click()
  const picker = page.locator('[data-picker="li2"]')
  await expect(picker.getByRole('radio').first()).toBeFocused()
  await picker.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await noSideScroll()
  await shotScreen('step4-picker')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(page.locator('[data-item-id="li2"] .refchip--level').first()).toContainText('Die Werkstatt hat zweimal pro Woche')

  // Three critical assumptions: the line under the list and the cue on each ticked row.
  await openScreen(page, 'step4-critical')
  const warning = page.locator('[data-group="tg1"] .bcritical')
  await expect(warning).toContainText('3 Annahmen sind als kritisch markiert')
  await expect(page.locator('[data-item-id="li3"]').getByText('3 von höchstens 2 kritisch')).toBeVisible()
  await page.locator('[data-item-id="li3"] [data-field="critical"]').scrollIntoViewIfNeeded()
  await shotScreen('step4-critical')
  await warning.scrollIntoViewIfNeeded()
  await shotScreen('step4-critical-line')
  // A long end chip is cut, never wraps under its arrow: arrow and chip share one line (design check step 18).
  const arrow = (await page.locator('[data-item-id="li6"] .blink__to').boundingBox())!
  const end = (await page.locator('[data-item-id="li6"] .blink__line--to .refchip').boundingBox())!
  expect(Math.abs(arrow.y + arrow.height / 2 - (end.y + end.height / 2))).toBeLessThan(4)

  // Check: ⛔ for the missing assumption, the app's ⚠ "Verbindung unvollständig" before Claude's note, with Zum Feld.
  await openScreen(page, 'step4-blocked')
  await expect(gate.getByText('Annahme fehlt: „Zehn Mädchen-Nachmittage im …“ → „Mädchen aus der Siedlung …“ · Mädchen 11–14 aus der Siedlung')).toBeVisible()
  await expect(gate.getByText('Warum fehlt: Aktivität „Elternbrief zu Beginn des Halbjahrs“')).toBeVisible()
  await shotScreen('step4-blocked')
  await page.locator('[data-group-toggle="tg3"]').click()
  await gate.getByRole('button', { name: /^Zum Feld: Verbindung unvollständig/ }).click()
  await expect(page.locator('[data-picker-toggle="li9"]')).toBeFocused()
  await expect(page.locator('[data-group-toggle="tg3"]')).toHaveAttribute('aria-expanded', 'true')
  await noPageScroll()

  // The card: a link named by its ends, waiting for the new output; "kritisch" on the meta line.
  await openScreen(page, 'step4-proposal')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card.getByText('Verbindung · Mädchen 11–14 aus der Siedlung')).toHaveCount(2)
  await expect(card.getByText('„Sechs bis acht Mädchen kommen zu den …“ → „Die Mädchen kommen wieder und bringen …“')).toBeVisible()
  await expect(card.getByText(/zuerst ‚Neu: Die Mädchen kommen wieder/)).toBeVisible()
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = 0))
  await shotScreen('step4-proposal')
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shotScreen('step4-proposal-end')

  await openScreen(page, 'step4-empty')
  await noPageScroll()
  await shotScreen('step4-empty')
  expect(errors).toEqual([])
})

test('step 18b: the one question under the card, shown once, the scroll when a tall card arrives', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const log = page.locator('.chat__log')
  const message = page.locator('.msg--assistant').filter({ has: page.locator('.pcard') })
  const question = message.locator('.msg__question')
  const toEnd = () => log.evaluate((el) => (el.scrollTop = el.scrollHeight))

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'
    for (const name of ['question', 'question-no-text', 'question-duplicate', 'question-long']) {
      await openScreen(page, name)
      await toEnd()
      // The message's last line, after the card and outside it, a plain 16/24 paragraph 16 px below the card.
      await expect(question).toHaveCount(1)
      expect(await message.evaluate((el) => el.lastElementChild!.classList.contains('msg__question'))).toBe(true)
      const style = await question.evaluate((el) => {
        const cs = getComputedStyle(el)
        const card = el.parentElement!.querySelector('.pcard')!.getBoundingClientRect()
        return { size: cs.fontSize, line: cs.lineHeight, weight: cs.fontWeight, gap: Math.round(el.getBoundingClientRect().top - card.bottom) }
      })
      expect(style).toEqual({ size: '16px', line: '24px', weight: '400', gap: 16 })
      expect(await log.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      await shotScreen(`${name}${suffix}`)
    }
  }

  // The tops of the two messages that differ: label → card with no gap left; text → card.
  for (const name of ['question-no-text', 'question-duplicate']) {
    await openScreen(page, name)
    await message.evaluate((el) => (el.closest('.chat__log')!.scrollTop = (el as HTMLElement).offsetTop - 12))
    await shotScreen(`${name}-top`)
  }
  await openScreen(page, 'question-no-text')
  const gap = await message.evaluate((el) => Math.round(el.querySelector('.pcard')!.getBoundingClientRect().top - el.querySelector('.msg__label')!.getBoundingClientRect().bottom))
  expect(gap).toBeLessThanOrEqual(12)

  // Shown once: the text's lead-in stays, its copy of the question goes; the card's line stays.
  await openScreen(page, 'question-duplicate')
  await expect(message.getByText('Passt das zu dem, was ihr an den Nachmittagen seht?')).toHaveCount(1)
  await expect(message.locator('.md p').last()).toHaveText(/kommen nicht alle an die Werkbank\.$/)
  await expect(question).toHaveText('Passt das zu dem, was ihr an den Nachmittagen seht?')

  // A card taller than the chat arrives: its top at the chat's top, the question below the fold.
  await page.setViewportSize({ width: 1390, height: 880 })
  await openScreen(page, 'question-arrival')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await card.waitFor()
  await expect
    .poll(() => card.evaluate((el) => Math.round(el.getBoundingClientRect().top - el.closest('.chat__log')!.getBoundingClientRect().top)))
    .toBe(12)
  expect(await question.evaluate((el) => el.getBoundingClientRect().top > el.closest('.chat__log')!.getBoundingClientRect().bottom)).toBe(true)
  // The jump button leads on to the question; a click goes to the end and back to the input.
  const jump = page.getByRole('button', { name: 'Zur neuesten Nachricht' })
  await expect(jump).toBeVisible()
  await shotScreen('question-arrival')
  await jump.click()
  await expect(jump).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Deine Nachricht' })).toBeFocused()
  await shotScreen('question-arrival-end')
  // Scrolling down by hand also ends it.
  await openScreen(page, 'question-arrival')
  await expect(jump).toBeVisible()
  await toEnd()
  await expect(jump).toBeHidden()
  expect(errors).toEqual([])
})

test('step 5 (step 19): candidates, question records with indicators, limits, picker, figures, check, card', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const column = page.locator('.workspace__block .workspace__scroll')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  const noSideScroll = async () => expect(await column.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'
    for (const screen of ['step5', 'step5-full']) {
      await openScreen(page, screen)
      await noPageScroll()
      await noSideScroll()
      await shotScreen(`${screen}${suffix}`)
      const height = await column.evaluate((el) => el.scrollHeight)
      const step = (await column.evaluate((el) => el.clientHeight)) - 60
      for (let top = step, i = 1; top < height; top += step, i++) {
        await column.evaluate((el, y) => (el.scrollTop = y), top)
        await page.waitForTimeout(50)
        await noSideScroll()
        await shotScreen(`${screen}-${i}${suffix}`)
      }
    }
  }
  await page.setViewportSize({ width: 1390, height: 880 })

  // Candidates: derived rows with the decision in words, no ✕.
  await openScreen(page, 'step5')
  await expect(page.locator('[data-candidate="li1"]')).toContainText('Aufgenommen in Frage 1')
  await expect(page.locator('[data-candidate="li4"]').getByText('Zurückgestellt, weil')).toBeVisible()
  await expect(page.locator('[data-candidate="li8"]').getByText('noch offen')).toBeVisible()
  await expect(page.locator('[data-candidate] .bitem__remove')).toHaveCount(0)
  await expect(page.getByText('Noch keine Lernfrage zu „Mädchen 11–14 aus der Siedlung“', { exact: false })).toBeVisible()

  // The picker: in place, focus on the first box, the deferred link selectable and labelled; Esc back to the toggle.
  const toggle = page.locator('[data-picker-toggle="fq2"]')
  await toggle.click()
  const picker = page.locator('[data-picker="fq2"]')
  await expect(picker.getByRole('checkbox').first()).toBeFocused()
  await expect(picker.getByText('· zurückgestellt')).toBeVisible()
  await picker.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await noSideScroll()
  await shotScreen('step5-picker')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(toggle).toBeFocused()

  // Removing a question: its record becomes one undo line that counts the indicators.
  await page.getByRole('button', { name: 'Lernfrage „Reparieren die Stammgäste ihr Rad …“ entfernen' }).click()
  await expect(page.getByText('„Reparieren die Stammgäste ihr Rad wirklich selbst?“ und 2 Indikatoren entfernt.')).toBeVisible()
  await page.getByRole('button', { name: 'Rückgängig' }).scrollIntoViewIfNeeded()
  await shotScreen('step5-undo')

  // Full: every "+" says why; the candidates' cue says it once.
  await openScreen(page, 'step5-full')
  await expect(page.getByText('Höchstens 3 Lernfragen.')).toBeVisible()
  await expect(page.getByText('Höchstens 2 je Frage.')).toHaveCount(3)
  await expect(page.getByText(/^Schon 3 Lernfragen – ergänze eine Annahme/)).toHaveCount(1)
  // On the row the reason is only read out (1 px, clipped), never shown again.
  expect((await page.locator('[data-candidate="li8"] [data-field="decide"] .btn-reason').boundingBox())!.width).toBeLessThanOrEqual(1)

  // Old deferral and orphan indicator.
  await openScreen(page, 'step5-old')
  await expect(page.getByText(/kein Kandidat mehr: „Die Ehrenamtlichen lassen sie selbst …“ \(nicht mehr kritisch\)/)).toBeVisible()
  await page.locator('.bcand__old').scrollIntoViewIfNeeded()
  await shotScreen('step5-old-deferral')
  await expect(page.getByRole('heading', { name: 'Indikatoren ohne Lernfrage' })).toBeVisible()
  await page.getByRole('heading', { name: 'Indikatoren ohne Lernfrage' }).scrollIntoViewIfNeeded()
  await noSideScroll()
  await shotScreen('step5-old')

  // Check: ⛔ rows, then Zum Feld to "Bezug wählen" and the app's ⚠ to the open candidate.
  await openScreen(page, 'step5-blocked')
  await expect(gate.getByText('Lernfrage ohne Bezug: Frage 1 „Bleiben die Ehrenamtlichen das ganze Jahr dabei …“')).toBeVisible()
  await shotScreen('step5-blocked')
  // The app's own ⚠ rows follow the ⛔ rows, one per criterion.
  await expect(gate.getByText(/^Kandidat noch offen: „Die zwei Ehrenamtlichen bleiben das ganze Jahr …“ \(und 1 weitere\)$/)).toBeAttached()
  await expect(gate.getByText(/^Ausgangswert fehlt: Indikator /)).toBeAttached()
  await gate.locator('.gate__rows').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shotScreen('step5-blocked-warn')
  await gate.getByRole('button', { name: /^Zum Feld: Lernfrage ohne Bezug/ }).click()
  await expect(page.getByRole('button', { name: 'Bezug wählen: Frage 1' })).toBeFocused()
  await gate.getByRole('button', { name: /^Zum Feld: Kandidat noch offen/ }).click()
  await expect(page.locator('[data-candidate="li1"]').getByRole('button', { name: /^Als Lernfrage aufnehmen/ })).toBeFocused()
  await noPageScroll()

  // The card: questions by text, the waiting indicator's reason, the figure's target.
  await openScreen(page, 'step5-proposal')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card.getByText('Indikator · zu neuer Frage „Trauen sich die Mädchen ohne Jungen an …“')).toBeVisible()
  await expect(card.getByText('Frage „Bleiben die Ehrenamtlichen das ganze …“ hat schon 2 Indikatoren.')).toBeVisible()
  await expect(card.getByText('Soll: 120 · Räder')).toBeVisible()
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = 0))
  await shotScreen('step5-proposal')
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shotScreen('step5-proposal-end')

  await expect(card.getByText('Das sehen wir jede Woche; die Ehrenamtlichen erzählen es uns.')).toBeAttached()
  await expect(card.getByText('Die Ehrenamtlichen lassen sie selbst machen, statt es …')).toBeAttached()

  await openScreen(page, 'step5-empty')
  await noPageScroll()
  await shotScreen('step5-empty')

  // The other states at the narrow width too.
  await page.setViewportSize({ width: 960, height: 760 })
  for (const screen of ['step5-old', 'step5-blocked', 'step5-proposal', 'step5-empty']) {
    await openScreen(page, screen)
    await noPageScroll()
    await noSideScroll()
    await shotScreen(`${screen}-960`)
  }
  await openScreen(page, 'step5')
  await page.locator('[data-picker-toggle="fq2"]').click()
  await page.locator('[data-picker="fq2"]').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await noSideScroll()
  await shotScreen('step5-picker-960')
  expect(errors).toEqual([])
})

test('step 6 (step 20): coverage from step 5, plan rows as disclosures, picker, check, card, full plan', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const column = page.locator('.workspace__block .workspace__scroll')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  const noSideScroll = async () => expect(await column.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  /** The whole block column, one shot per screenful. */
  const shotColumn = async (name: string) => {
    await column.evaluate((el) => (el.scrollTop = 0))
    await shotScreen(name)
    const height = await column.evaluate((el) => el.scrollHeight)
    const step = (await column.evaluate((el) => el.clientHeight)) - 60
    for (let top = step, i = 1; top < height; top += step, i++) {
      await column.evaluate((el, y) => (el.scrollTop = y), top)
      await page.waitForTimeout(50)
      await noSideScroll()
      await shotScreen(`${name}-${i}`)
    }
  }
  const openRow = (id: string) => page.locator(`[data-row-toggle="${id}"]`).click()

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'
    // Four rows start closed; the first is opened to show every field.
    await openScreen(page, 'step6')
    await expect(page.locator('[data-row-toggle]')).toHaveCount(4)
    await openRow('pr1')
    await noPageScroll()
    await noSideScroll()
    await shotColumn(`step6${suffix}`)
    for (const screen of ['step6-full', 'step6-empty', 'step6-none', 'step6-blocked', 'step6-proposal']) {
      await openScreen(page, screen)
      await noPageScroll()
      await noSideScroll()
      await shotScreen(`${screen}${suffix}`)
    }
  }
  await page.setViewportSize({ width: 1390, height: 880 })

  // Coverage: one indicator still without a row; closed rows keep their references, summary and "Noch leer".
  await openScreen(page, 'step6')
  await expect(page.locator('[data-coverage="in2"]').getByText('noch ohne Planzeile')).toBeVisible()
  await expect(page.locator('[data-coverage="in1"]')).toContainText('In Zeile 1 und 3')
  await expect(page.locator('[data-coverage] .bitem__remove')).toHaveCount(0)
  const closed = page.locator('[data-item-id="pr3"]')
  await expect(closed.getByText('Noch leer: Erster Termin, Einwilligung und Datenschutz, Auswertung und Nutzung, Warum?')).toBeVisible()
  // A closed row's chips take at most two lines each.
  for (const chip of await closed.locator('.refchip--level').all()) expect((await chip.boundingBox())!.height).toBeLessThan(60)

  // The picker: in place, grouped by question, another row's cover shown; Esc back to the toggle.
  await page.locator('[data-picker-toggle="pr4"]').click()
  const picker = page.locator('[data-picker="pr4"]')
  await expect(picker.getByRole('checkbox').first()).toBeFocused()
  await expect(picker.getByText('· in Zeile 1 und 3')).toBeVisible()
  await expect(picker.getByText('Verweis fehlt (gelöscht)')).toBeVisible()
  await picker.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await noSideScroll()
  await shotScreen('step6-picker')
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(page.locator('[data-picker-toggle="pr4"]')).toBeFocused()

  // Removing a row: one undo line, the coverage line switches at once.
  await page.getByRole('button', { name: 'Planzeile „Anzahl reparierter Räder“ entfernen' }).click()
  await expect(page.getByText('Planzeile „Anzahl reparierter Räder“ entfernt.')).toBeVisible()
  await expect(page.locator('[data-coverage="mf3"]').getByText('noch ohne Planzeile')).toBeVisible()
  await page.getByRole('button', { name: 'Rückgängig' }).scrollIntoViewIfNeeded()
  await shotScreen('step6-undo')

  // "Planzeile anlegen": a new row, open, cursor in Datenquelle with the step 0 hint under it.
  await openScreen(page, 'step6')
  await page.locator('[data-coverage="in2"]').getByRole('button', { name: /^Planzeile anlegen/ }).click()
  await expect(page.locator('[data-item-id="pr5"] [data-field="dataSource"] textarea')).toBeFocused()
  await expect(page.locator('[data-item-id="pr5"]').getByText(/^Aus Schritt 0 vorhanden: Anwesenheitsliste/)).toBeVisible()
  await expect(page.locator('[data-item-id="pr5"]').getByText(/^Ausgangswert laut Schritt 5: nachträglich/)).toBeVisible()
  await shotScreen('step6-created')

  // Check: ⛔ rows first, then the app's grouped ⚠; Zum Feld opens a closed row.
  await openScreen(page, 'step6-blocked')
  await expect(gate.getByText(/^Warum fehlt: Zeile 1 „Anzahl der Öffnungstage, an denen …“$/)).toBeVisible()
  await expect(page.locator('[data-item-id="pr2"] .refchip--missing')).toHaveCount(2)
  await expect(gate.getByText('Verweis fehlt: Zeile 2 „Anwesenheitsliste und Anmeldebogen“')).toBeAttached()
  await expect(gate.getByText('Indikator ohne Planzeile: „Anteil der Stammgäste, die ihr Rad nach einer …“')).toBeAttached()
  await gate.locator('.gate__rows').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await shotScreen('step6-blocked-warn')
  await gate.getByRole('button', { name: /^Zum Feld: Warum fehlt: Zeile 1/ }).click()
  await expect(page.locator('[data-row-toggle="pr1"]')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-item-id="pr1"] [data-field="why"] textarea')).toBeFocused()
  await gate.getByRole('button', { name: /^Zum Feld: Indikator ohne Planzeile/ }).click()
  await expect(page.locator('[data-coverage="in2"]').getByRole('button', { name: /^Planzeile anlegen/ })).toBeFocused()
  await noPageScroll()

  // The card: rows by what they cover, the four facts as meta, never a row number; focus on a row outlines the closed head.
  await openScreen(page, 'step6-proposal')
  const card = page.getByRole('article', { name: 'Vorschlag' })
  await expect(card.getByText('für „Anteil der Stammgäste, die ihr Rad …“')).toBeVisible()
  await expect(card.getByText(/Zeile \d/)).toHaveCount(0)
  await card.getByRole('button', { name: /^Übernehmen: Ändern/ }).focus()
  const head = page.locator('[data-group-header="pr3"]')
  await expect(head).toHaveAttribute('data-outlined', '')
  // The outline must show, not only be set (design check step 20).
  expect(await head.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  await expect(page.locator('[data-row-toggle="pr3"]')).toHaveAttribute('aria-expanded', 'false')
  await shotScreen('step6-proposal-focus')
  await page.locator('.chat__log').evaluate((el) => (el.scrollTop = 0))
  await shotScreen('step6-proposal')

  // Full plan: 7 closed rows and the coverage list folded away.
  await openScreen(page, 'step6-full')
  await expect(page.getByText('Alle 6 Indikatoren und 3 Pflichtangaben haben eine Planzeile.')).toBeVisible()
  await expect(page.locator('[data-coverage]')).toHaveCount(0)
  await shotColumn('step6-full')
  expect(errors).toEqual([])
})

test('change handling (step 21): outdated banner, review states, outdated gate, cascade line', async ({ page }) => {
  const shotScreen = (name: string) => page.screenshot({ path: `screenshots/gallery/screen-${name}.png`, animations: 'disabled' })
  const errors = watchErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const gate = page.getByRole('region', { name: 'Qualitätscheck' })
  const banner = page.locator('.workspace__block .outdated')
  const noPageScroll = async () => expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  const noSideScroll = async () => expect(await page.locator('.workspace__block').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  const screens = ['outdated', 'outdated-several', 'outdated-frame', 'outdated-frame-plus', 'outdated-running', 'outdated-busy', 'outdated-reviewed', 'outdated-cascade', 'outdated-cascade-one']

  for (const size of [
    { width: 1390, height: 880 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size)
    const suffix = size.width === 1390 ? '' : '-960'
    for (const screen of screens) {
      await openScreen(page, screen)
      await noPageScroll()
      await noSideScroll()
      await shotScreen(`${screen}${suffix}`)
    }
    // The checked banner keeps to the text plus one line (design: "Nochmal prüfen lassen" inline).
    await openScreen(page, 'outdated-reviewed')
    const again = banner.getByRole('button', { name: 'Nochmal prüfen lassen' })
    const text = banner.locator('.banner__text')
    expect((await again.boundingBox())!.y + (await again.boundingBox())!.height).toBeLessThanOrEqual((await text.boundingBox())!.y + (await text.boundingBox())!.height + 1)
    expect((await banner.boundingBox())!.height).toBeLessThan(size.width === 1390 ? 80 : 110)
  }
  await page.setViewportSize({ width: 1390, height: 880 })

  // Outdated step 4: the banner sits above the scrolling block, stays while it scrolls, and is no live region.
  await openScreen(page, 'outdated')
  await expect(banner).toContainText('Schritt 2 hat sich geändert, seit du diesen Schritt bestätigt hast. Vielleicht passt hier etwas nicht mehr.')
  await expect(banner.locator('[role="status"], [role="alert"]')).toHaveCount(1) // only the hidden status line
  await expect(banner.locator('.banner')).not.toHaveAttribute('role')
  await expect(page.locator('.workspace__scroll .outdated')).toHaveCount(0)
  const top = (await banner.boundingBox())!.y
  await page.locator('.workspace__block .workspace__scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
  expect((await banner.boundingBox())!.y).toBe(top)
  await expect(gate.getByText('Bestätigt am 04.11. – seitdem hat sich Schritt 2 geändert.')).toBeVisible()
  await expect(gate.getByRole('button', { name: 'Bestätigen' })).not.toHaveAttribute('aria-disabled')
  await expect(page.locator('.btn--primary')).toHaveCount(1)
  // Keyboard: the step link is the first stop in the block column and shows the ring.
  const link = banner.getByRole('button', { name: 'Zu Schritt 2' })
  await link.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
  await shotScreen('outdated-focus')
  await link.press('Enter')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Problem/)

  // Wording of several changes and of the frame.
  await openScreen(page, 'outdated-several')
  await expect(banner).toContainText('Schritt 0 und Schritt 2 haben sich geändert')
  await openScreen(page, 'outdated-frame')
  await expect(banner).toContainText('Der Messrahmen in Schritt 0 hat sich geändert')
  await openScreen(page, 'outdated-frame-plus')
  await expect(banner).toContainText('Schritt 0 (Messrahmen) und Schritt 2 haben sich geändert')

  // Running, waiting for another answer, checked (the app line in the chat).
  await openScreen(page, 'outdated-running')
  await expect(banner.getByRole('button', { name: 'prüft die Änderung …' })).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.chat__act').getByText('Änderung prüfen lassen: Schritt 2')).toBeVisible()
  await openScreen(page, 'outdated-busy')
  await expect(banner.getByText('Warte, bis die Antwort im Chat fertig ist.')).toBeVisible()
  await openScreen(page, 'outdated-reviewed')
  await expect(banner).toContainText('Die Antwort der Wirkungshelferin steht im Chat. Passt alles, bestätige unten erneut.')
  // The app line's icon is muted, not the warn colour (it stays in the history).
  const icon = page.locator('.chat__act svg').last()
  expect(await icon.evaluate((el) => getComputedStyle(el).color)).toBe(await page.locator('.chat__act').last().evaluate((el) => getComputedStyle(el).color))

  // The re-confirmed step names what it marked.
  await openScreen(page, 'outdated-cascade')
  await expect(gate.getByText('Darauf bauen Schritt 3, 4, 5 und 6 auf – sie sind jetzt als „vielleicht veraltet“ markiert.')).toBeVisible()
  await expect(banner).toHaveCount(0)
  for (const s of [3, 4, 5, 6]) await expect(page.getByRole('button', { name: new RegExp(`^${s} .*, vielleicht veraltet$`) })).toBeVisible()
  await openScreen(page, 'outdated-cascade-one')
  await expect(gate.getByText('Darauf baut Schritt 6 auf – er ist jetzt als „vielleicht veraltet“ markiert.')).toBeVisible()
  expect(errors).toEqual([])
})
