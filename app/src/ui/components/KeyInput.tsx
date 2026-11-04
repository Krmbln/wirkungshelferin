import type { ComponentProps } from 'react'
import './KeyInput.css'

// The API key field. A text input drawn as dots: a type="password" field makes Chrome's
// password manager offer to save the key (step 6 test), and it isn't a website password.
export function KeyInput({ className, ...rest }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      {...rest}
      type="text"
      className={`${className ?? ''} key-input`}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
    />
  )
}
