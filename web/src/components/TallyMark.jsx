// The tick is a tally mark: a vertical stroke that gets a diagonal slash drawn
// through it. You are making a mark on a sheet, not filling in a checkbox.
//
// This is a real control, not a styled div. A custom tick glyph is the easiest
// place to ship something unusable by keyboard or screen reader.

export function TallyMark({ checked, onChange, label }) {
  return (
    <span
      className="tally"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onClick={onChange}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange()
        }
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <line className="stem" x1="12" y1="4" x2="12" y2="20" />
        <line className="slash" x1="5" y1="19" x2="19" y2="5" />
      </svg>
    </span>
  )
}

/** Decorative mark used in the 7-day strip and the year view. */
export function TallyDot({ on, title }) {
  return (
    <svg
      className={on ? 'tally-sm on' : 'tally-sm'}
      viewBox="0 0 10 14"
      aria-hidden="true"
    >
      {title ? <title>{title}</title> : null}
      <line className="stem" x1="5" y1="2" x2="5" y2="12" />
      {on ? <line className="slash" x1="1" y1="11" x2="9" y2="3" /> : null}
    </svg>
  )
}
