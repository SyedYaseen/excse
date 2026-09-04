// The tick is a tally mark: a vertical stroke that gets a diagonal slash drawn
// through it. You are making a mark on a sheet, not filling in a checkbox.
//
// The glyph itself is decorative. The control is the row that contains it --
// `<button role="checkbox">` -- so tapping anywhere along the name strikes it
// out, which is the gesture people actually reach for. A 44px glyph inside a
// full-width row means the visible mark is still its own honest target.

export function TallyMark({ checked }) {
  return (
    <span className="tally" data-on={checked} aria-hidden="true">
      <svg viewBox="0 0 24 24">
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
