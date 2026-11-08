import type { ReactNode } from 'react'
import type { Step } from '../steps'
import './StepWorkspace.css'

// Chat left (~45 %), block right (~55 %), sticky check area under the block (design §5.2, §6.2).
// The check area holds the quality gate (step 13); steps without a block yet keep a placeholder.
export function StepWorkspace({ step, chat, block, check }: { step: Step; chat: ReactNode; block: ReactNode; check?: ReactNode }) {
  return (
    <div className="workspace" data-step={step.id}>
      <section className="workspace__chat" aria-label="Chat">
        {chat}
      </section>

      <section className="workspace__block" aria-labelledby="block-heading">
        <div className="workspace__scroll">
          <h2 id="block-heading">Baustein</h2>
          {block}
        </div>
        <div className="workspace__check" aria-labelledby="check-heading" role="region">
          <h2 id="check-heading" className="workspace__check-heading">
            Qualitätscheck
          </h2>
          {check ?? <p className="placeholder">Hier prüfst du den Baustein, bevor du ihn bestätigst.</p>}
        </div>
      </section>
    </div>
  )
}
