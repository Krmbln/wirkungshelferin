import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Banner } from '../../src/ui/components/Banner'
import { Button } from '../../src/ui/components/Button'
import { Chip } from '../../src/ui/components/Chip'
import { Dialog } from '../../src/ui/components/Dialog'
import { Icon, iconNames } from '../../src/ui/components/Icon'
import { StatusIcon, type Status } from '../../src/ui/components/StatusIcon'
import { ThinkingIndicator } from '../../src/ui/components/ThinkingIndicator'
import { Tooltip } from '../../src/ui/components/Tooltip'
import { ChromeGate } from '../../src/ui/gate/ChromeGate'

describe('Button', () => {
  it.each(['primary', 'secondary', 'text'] as const)('renders the %s variant', (variant) => {
    render(<Button variant={variant}>Übernehmen</Button>)
    const button = screen.getByRole('button', { name: 'Übernehmen' })
    expect(button.className).toContain(`btn--${variant}`)
    expect(button.getAttribute('aria-disabled')).toBeNull()
  })

  it('shows the reason next to a disabled button and links it', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" disabledReason="Noch 2 Punkte blockieren das Bestätigen" onClick={onClick}>
        Bestätigen
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Bestätigen' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const reason = screen.getByText('Noch 2 Punkte blockieren das Bestätigen')
    expect(button.getAttribute('aria-describedby')).toBe(reason.id)

    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps a disabled button reachable by keyboard', async () => {
    render(<Button disabledReason="Grund">Bestätigen</Button>)
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bestätigen' }))
  })

  it('shows the busy label and ignores clicks while busy', async () => {
    const onClick = vi.fn()
    render(
      <Button busy busyLabel="prüft …" onClick={onClick}>
        Prüfen
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'prüft …' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ignores a second click while its promise runs, then works again', async () => {
    let finish!: () => void
    const onClick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(
      <Button busyLabel="prüft …" onClick={onClick}>
        Prüfen
      </Button>,
    )
    const button = screen.getByRole('button')
    // Two clicks in the same tick, before React re-renders.
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.textContent).toBe('prüft …')

    await act(async () => finish())
    expect(button.textContent).toBe('Prüfen')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('resets after a rejected promise', async () => {
    const onClick = vi.fn(() => Promise.reject(new Error('x')))
    render(<Button onClick={onClick}>Prüfen</Button>)
    await act(async () => fireEvent.click(screen.getByRole('button')))
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBeNull()
  })
})

describe('Icon', () => {
  it('is hidden from screen readers without a label', () => {
    const { container } = render(<Icon name="send" />)
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('is an image with a name when labelled', () => {
    render(<Icon name="close" label="Schließen" />)
    expect(screen.getByRole('img', { name: 'Schließen' })).toBeTruthy()
  })

  it('has every icon from design §8', () => {
    for (const name of [
      'statusTodo',
      'statusProgress',
      'statusOk',
      'statusWarn',
      'statusBlock',
      'send',
      'stop',
      'plus',
      'close',
      'copy',
      'settings',
      'backup',
      'chevronRight',
      'chevronDown',
      'pencil',
    ]) {
      expect(iconNames).toContain(name)
    }
  })
})

describe('StatusIcon', () => {
  const labels: Record<Status, string> = {
    todo: 'noch nicht begonnen',
    progress: 'in Arbeit',
    done: 'bestätigt',
    stale: 'vielleicht veraltet',
    ok: 'erfüllt',
    warn: 'offener Punkt',
    block: 'blockiert das Bestätigen',
  }

  it.each(Object.entries(labels))('%s has the aria-label "%s"', (status, label) => {
    render(<StatusIcon status={status as Status} />)
    expect(screen.getByRole('img', { name: label })).toBeTruthy()
  })

  it('shows its label as a tooltip on hover', async () => {
    render(<StatusIcon status="stale" />)
    await userEvent.hover(screen.getByRole('img'))
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('vielleicht veraltet')
  })

  it('reads its label once, not again as a description', async () => {
    render(<StatusIcon status="done" />)
    await userEvent.hover(screen.getByRole('img'))
    expect(document.querySelector('[aria-describedby]')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('adds no tab stop', async () => {
    render(<StatusIcon status="done" />)
    await userEvent.tab()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('Tooltip', () => {
  function renderTerm() {
    render(
      <Tooltip content="Wie Aktivitäten zu Zielen führen.">
        <span>Wirkungslogik</span>
      </Tooltip>,
    )
    return screen.getByText('Wirkungslogik').parentElement!
  }

  it('opens on Enter and closes on Esc', async () => {
    const trigger = renderTerm()
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()

    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('tooltip').textContent).toBe('Wie Aktivitäten zu Zielen führen.')
    expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('closes on blur', async () => {
    renderTerm()
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('stays open while the pointer moves onto the bubble', async () => {
    const trigger = renderTerm()
    await userEvent.hover(trigger)
    await userEvent.hover(screen.getByRole('tooltip'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('opens leftwards for a trigger in the right half', async () => {
    const trigger = renderTerm()
    vi.spyOn(trigger.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 900 } as DOMRect)
    vi.stubGlobal('innerWidth', 1280)
    await userEvent.hover(trigger)
    expect(trigger.parentElement!.classList.contains('tooltip--end')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('opens on hover and Esc closes it without focus', async () => {
    const trigger = renderTerm()
    await userEvent.hover(trigger)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Chip', () => {
  it.each([
    ['new', 'Neu'],
    ['change', 'Ändern'],
    ['remove', 'Entfernen'],
    ['stale', 'Veraltet'],
  ] as const)('%s reads "%s"', (kind, label) => {
    render(<Chip kind={kind} />)
    expect(screen.getByText(label).className).toContain(`chip--${kind}`)
  })
})

describe('Banner', () => {
  it('announces a blocking banner as an alert, with icon and word', () => {
    render(<Banner tone="block">Speichern hat nicht geklappt</Banner>)
    const banner = screen.getByRole('alert')
    expect(banner.textContent).toContain('Speichern hat nicht geklappt')
    expect(screen.getByRole('img', { name: 'blockiert das Bestätigen' })).toBeTruthy()
  })

  it('uses a polite status for warn and neutral', () => {
    render(
      <>
        <Banner tone="warn">Warnung</Banner>
        <Banner tone="neutral" actions={<Button>Später</Button>}>
          Neutral
        </Banner>
      </>,
    )
    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Später' })).toBeTruthy()
  })
})

describe('Dialog', () => {
  function renderDialog(open: boolean, onClose = vi.fn()) {
    return render(
      <Dialog open={open} title="Backup laden?" onClose={onClose} actions={<Button>Abbrechen</Button>}>
        <p>Text</p>
      </Dialog>,
    )
  }

  it('opens modally and is labelled by its title', () => {
    renderDialog(true)
    const dialog = screen.getByRole('dialog', { name: 'Backup laden?' })
    expect((dialog as HTMLDialogElement).open).toBe(true)
  })

  it('focuses the safe action marked data-autofocus', () => {
    render(
      <Dialog
        open
        title="Backup laden?"
        onClose={() => {}}
        actions={
          <>
            <Button data-autofocus>Abbrechen</Button>
            <Button variant="primary">Backup laden</Button>
          </>
        }
      >
        <p>Text</p>
      </Dialog>,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }))
  })

  it('stays closed when not open', () => {
    renderDialog(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports Esc to its owner instead of closing itself', () => {
    const onClose = vi.fn()
    renderDialog(true, onClose)
    const dialog = screen.getByRole('dialog') as HTMLDialogElement
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(true)
  })

  it('closes when the owner says so', () => {
    const { rerender } = renderDialog(true)
    rerender(
      <Dialog open={false} title="Backup laden?" onClose={() => {}} actions={null}>
        <p>Text</p>
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('reduced motion', () => {
  const listeners = new Set<() => void>()
  let reduce = false

  function mockMatchMedia() {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        get matches() {
          return reduce
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      })),
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    listeners.clear()
  })

  const dot = () => document.querySelector('.thinking__dot')!

  it('pulses when motion is allowed', () => {
    reduce = false
    mockMatchMedia()
    render(<ThinkingIndicator />)
    expect(dot().classList.contains('thinking__dot--pulse')).toBe(true)
  })

  it('stays static under prefers-reduced-motion', () => {
    reduce = true
    mockMatchMedia()
    render(<ThinkingIndicator />)
    expect(dot().classList.contains('thinking__dot--pulse')).toBe(false)
  })

  it('follows a change of the setting while open', () => {
    reduce = false
    mockMatchMedia()
    render(<ThinkingIndicator />)
    reduce = true
    act(() => listeners.forEach((fn) => fn()))
    expect(dot().classList.contains('thinking__dot--pulse')).toBe(false)
  })
})

describe('ChromeGate', () => {
  it('confirms the copy for 2 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ChromeGate appUrl="https://example.org/app/" />)

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }))
    expect(await navigator.clipboard.readText()).toBe('https://example.org/app/')
    expect(screen.getByRole('button', { name: 'Kopiert' })).toBeTruthy()

    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Link kopieren' })).toBeTruthy()
    vi.useRealTimers()
  })

  it('selects the link and says so when the clipboard refuses', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<ChromeGate appUrl="https://example.org/app/" />)

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }))
    expect(screen.getByText(/Kopieren ging nicht/)).toBeTruthy()
    expect(window.getSelection()?.toString()).toBe('https://example.org/app/')
    expect(screen.queryByRole('button', { name: 'Kopiert' })).toBeNull()
  })
})
