import { useState } from 'react'

function nameList(items) {
  const names = items.map((e) => e.name)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/**
 * One button, two characters. It only becomes the primary action once the
 * cycle is actually finished, so a stray tap can't wipe a cycle in progress --
 * ending early is deliberately the quieter of the two and asks first.
 */
export function CycleButton({ progress, skipped, nextSeq, onEnd }) {
  const [confirming, setConfirming] = useState(false)

  if (progress.total === 0) return null

  if (progress.complete) {
    return (
      <div className="cycle-action">
        <button className="btn btn-primary" onClick={() => onEnd()}>
          Start cycle {nextSeq}
        </button>
      </div>
    )
  }

  return (
    <div className="cycle-action">
      <button className="btn" onClick={() => setConfirming(true)}>
        End cycle early
      </button>

      {confirming && (
        <div
          className="sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="End cycle early"
          onClick={(e) => e.target === e.currentTarget && setConfirming(false)}
        >
          <div className="sheet">
            <h2>End cycle early?</h2>
            <p>
              {nameList(skipped)} will come back first next cycle.
            </p>
            <div className="sheet-actions">
              <button
                className="btn btn-danger"
                onClick={() => {
                  setConfirming(false)
                  onEnd()
                }}
              >
                End cycle and start {nextSeq}
              </button>
              <button className="btn" onClick={() => setConfirming(false)}>
                Keep going
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
