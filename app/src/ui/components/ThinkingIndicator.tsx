import { useReducedMotion } from '../motion'
import './ThinkingIndicator.css'

// "denkt nach …" with a subtle pulsing dot; static under reduced motion (design §6.2).
// `announce={false}` when it shows again within the same message (the chat announces once).
// `label` names other waits that work the same way, e.g. the summary before a new chat segment.
export function ThinkingIndicator({ announce = true, label = 'denkt nach …' }: { announce?: boolean; label?: string }) {
  const reduced = useReducedMotion()
  return (
    <span className="thinking" role={announce ? 'status' : undefined}>
      <span className={reduced ? 'thinking__dot' : 'thinking__dot thinking__dot--pulse'} aria-hidden="true" />
      {label}
    </span>
  )
}
