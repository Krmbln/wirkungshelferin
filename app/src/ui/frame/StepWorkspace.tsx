import type { Step } from '../steps'
import './StepWorkspace.css'

// Chat left (~45 %), block right (~55 %), sticky check area under the block (design §5.2, §6.2).
// Placeholders until steps 9–13 fill each area.
export function StepWorkspace({ step }: { step: Step }) {
  return (
    <div className="workspace" data-step={step.id}>
      <section className="workspace__chat" aria-label="Chat">
        <div className="workspace__scroll">
          <p className="placeholder">Hier sprichst du bald mit der Wirkungshelferin über diesen Schritt.</p>
        </div>
        <div className="workspace__composer placeholder-box">Schreib deine Antwort …</div>
      </section>

      <section className="workspace__block" aria-labelledby="block-heading">
        <div className="workspace__scroll">
          <h2 id="block-heading">Baustein</h2>
          <p className="placeholder">Noch leer – hier entsteht der Baustein für diesen Schritt.</p>
        </div>
        <div className="workspace__check" aria-labelledby="check-heading" role="region">
          <h2 id="check-heading" className="workspace__check-heading">
            Qualitätscheck
          </h2>
          <p className="placeholder">Hier prüfst du den Baustein, bevor du ihn bestätigst.</p>
        </div>
      </section>
    </div>
  )
}
