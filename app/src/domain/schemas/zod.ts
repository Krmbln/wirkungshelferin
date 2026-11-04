import { z } from 'zod'

// Our CSP has no 'unsafe-eval'. Zod's fast path compiles validators with new Function and
// probes for it, which Chrome reports as a CSP violation. jitless must be set before any
// schema is built, so every schema file imports z from here.
z.config({ jitless: true })

export { z }
