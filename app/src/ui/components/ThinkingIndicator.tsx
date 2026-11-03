import { useReducedMotion } from '../motion'
import './ThinkingIndicator.css'

// "denkt nach …" with a subtle pulsing dot; static under reduced motion (design §6.2).
export function ThinkingIndicator() {
  const reduced = useReducedMotion()
  return (
    <span className="thinking" role="status">
      <span className={reduced ? 'thinking__dot' : 'thinking__dot thinking__dot--pulse'} aria-hidden="true" />
      denkt nach …
    </span>
  )
}
