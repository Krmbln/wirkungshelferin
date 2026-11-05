import { useReducedMotion } from '../motion'
import './ThinkingIndicator.css'

// "denkt nach …" with a subtle pulsing dot; static under reduced motion (design §6.2).
// `announce={false}` when it shows again within the same message (the chat announces once).
export function ThinkingIndicator({ announce = true }: { announce?: boolean }) {
  const reduced = useReducedMotion()
  return (
    <span className="thinking" role={announce ? 'status' : undefined}>
      <span className={reduced ? 'thinking__dot' : 'thinking__dot thinking__dot--pulse'} aria-hidden="true" />
      denkt nach …
    </span>
  )
}
