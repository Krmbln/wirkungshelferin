import type { Page } from '@playwright/test'

// Every test starts with an empty browser profile, so the app opens on the empty state.
export async function startProject(page: Page): Promise<void> {
  await page.goto('./')
  await page.getByRole('button', { name: 'Neu starten' }).click()
  await page.getByRole('heading', { level: 1, name: 'Übersicht' }).waitFor()
}

// Collects CSP violations and console errors from the moment the page starts.
export async function watchProblems(page: Page): Promise<string[]> {
  const problems: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
  await page.exposeFunction('__reportCsp', (v: string) => problems.push(`csp: ${v}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __reportCsp: (v: string) => void }).__reportCsp(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    )
  })
  return problems
}
