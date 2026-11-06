import { Fragment, useId } from 'react'
import { termEntries, type StepIntro } from '../../guide/intro'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

// Top of the chat, above the messages (design §6.2): what the step is about, why it matters,
// and its key terms with the glossary definition one hover, click or Enter away.
export function IntroPanel({ intro, open, onToggle }: { intro: StepIntro; open: boolean; onToggle: () => void }) {
  const id = useId()
  return (
    <div className="intro" data-open={open || undefined}>
      <h2 className="intro__heading">
        <button type="button" className="intro__toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          Worum geht es?
          <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        </button>
      </h2>
      <div id={id} className="intro__body" hidden={!open}>
        <p>{intro.what}</p>
        <h3 className="intro__label">Warum?</h3>
        <p>{intro.why}</p>
        <p className="intro__terms">
          <span className="intro__label">Begriffe: </span>
          {intro.terms.map((term, i) => (
            <Fragment key={term}>
              {i > 0 && ' · '}
              <Term term={term} />
            </Fragment>
          ))}
        </p>
      </div>
    </div>
  )
}

export function Term({ term }: { term: string }) {
  const entries = termEntries(term)
  if (!entries.length) return <>{term}</>
  const content =
    entries.length === 1 ? (
      <Definition plain={entries[0].plain} technical={entries[0].technical} />
    ) : (
      entries.map((e) => (
        <span key={e.term} className="term__entry">
          <strong>{e.term}:</strong> <Definition plain={e.plain} technical={e.technical} />
        </span>
      ))
    )
  return (
    <Tooltip content={content} fixed>
      <span className="term">{term}</span>
    </Tooltip>
  )
}

function Definition({ plain, technical }: { plain: string; technical?: string }) {
  return (
    <>
      {plain}
      {technical && <> Fachwort: {technical}.</>}
    </>
  )
}
