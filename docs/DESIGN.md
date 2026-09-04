# Design

Produced with the `frontend-design` skill. Extend this rather than drifting back to defaults.

## Grounding

One person, at home, on a phone, mid-workout, answering *"what haven't I done yet?"* in under
two seconds with one thumb. Not a gym-bro app (no chrome, no neon, no BEAST MODE), not a
clinical health dashboard. The nearest real-world object is a **tally sheet** — quiet,
repetitive, unglamorous, about accumulation over time. Every choice below comes from that.

## The one bold move: the tick *is* a tally mark

Not a rounded square with a checkmark. Each exercise carries a single vertical stroke; tapping
draws a diagonal slash through it — the tally gesture — and strikes through the name. You are
literally making a mark on a sheet. One glyph, readable at arm's length, and it scales from the
daily band to the year view.

Everything else stays quiet. Boldness is spent here and nowhere else.

The mark is a real control: `<button role="checkbox" aria-checked>` with the stroke in SVG, a
≥44px hit area, and a visible focus ring. A custom tick glyph is the easiest place in this
design to accidentally ship something unusable by keyboard or screen reader.

## Tokens

**Color.** Ground is a pale cool chalk-grey. The accent appears in exactly two places: the cycle
button and today's marker on the calendar. Completion reads as strike-through and dimming, not
colour, so the palette stays almost monochrome.

Deliberately avoided: the cream/serif/terracotta cluster, and the near-black + acid-accent
cluster that fitness apps default to.

```
light   paper #E8EAE6   raise #F5F6F3   rule #C9CDC7
        ink   #1A1F1C   ink-2 #5C6360   done #8B928D   mark #2E4756
dark    paper #14171A   raise #1C2023   rule #2C3235
        ink   #E6E9E5   ink-2 #8D948F   done #5A615C   mark #7FB2CC
```

**Type.** One family: Archivo variable (SIL OFL), self-hosted woff2, latin subset, keeping both
`wght` and `wdth` axes since the design uses width. Two roles from the width axis rather than a
second typeface: expanded for the few display moments, regular for the list. Inter and Space
Grotesk are the defaults here and are avoided.

Counts use `font-variant-numeric: tabular-nums` so the list never jitters — function, not the
monospace-data-label tell.

**Layout.** Left-aligned throughout, counts right-aligned to one column — ledger alignment.
No hero banner and no cards anywhere. The list *is* the hero: content starts at the top of the
viewport. Cycle progress is a 2px rule spanning the full width that fills left-to-right, serving
as both the app's only chrome and its only stat. Structure comes from rules and vertical rhythm,
never bordered boxes or shadows.

A **double rule** separates the daily band from the rotation. That is structural information,
not decoration: it encodes "above resets nightly, below persists" without a label saying so.

```
 ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░   ← progress rule = the entire header
 Cycle 3                  11 left

 Crunches      ╱ ╱ ╱ · ╱ ╱ ╱   ╱│    ← last 7 days, then today's mark
 Plank         · ╱ ╱ · ╱ ╱ ╱   ╱│
 Squats        ╱ · ╱ ╱ · · ╱    │    ← today not yet marked
 ═════════════════════════════════   ← above resets nightly, below persists

 Back                          0/4
   │  Superman        skipped twice
   │  Bird dog
   │  Reverse snow angel

 Core                          1/3
   │  Leg raises
  ╱│  Hollow hold
 ─────────────────────────────────
  Chest                        4/4
  Shoulders                    3/3
```

## The year view is the payoff

The permanent `active_days` record renders as 52 columns of 7 tally strokes — a wall of marks
accumulated over a year. Not GitHub squares, which is the default and would undercut the
metaphor. This is the emotional payload of the whole brief, so it gets the strongest single
image in the app.

## Motion

One orchestrated moment, answering a user action: on tick the slash strokes in over ~140ms, the
name strikes through, and if that completed a category, the category collapses and settles into
the completed zone. No page-load fades, no per-row hover transitions.
`prefers-reduced-motion` drops all of it to instant state changes.

## Copy

Plain, active, from the user's perspective, each element doing one job.

- Complete → `Start cycle 4`. Incomplete → `End cycle early`.
- Confirm sheet: *"Superman, Bird dog and 3 more will carry to the top of your next cycle."*
- Unsynced: *"Not saved yet"* — what the user cares about, not "Offline".
- Login failure: *"Wrong username or password."* No apology, not vague.
- Empty state: *"Add the exercises you can do at home. You'll tick them off as you go."*

## Quality floor

`theme.css` defines the light palette on bare `:root`, redefines tokens under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again
under `:root[data-theme="dark"]` so the toggle wins both directions. Settings cycles
system → light → dark and updates `<meta name="theme-color">`.

≥44px touch targets, visible keyboard focus, `env(safe-area-inset-*)` padding,
`navigator.vibrate(10)` on tick, tap-again to untick.

## Tells to keep avoiding

From the `frontend-design` skill's calibration list — these were caught and removed during
design, so don't let them creep back:

- tracked-out ALL-CAPS eyebrow labels above headings (use sentence case)
- meta strings joined with middle dots (`A · B · C`)
- identical rounded cards with one border-radius and the same soft grey shadow
- a monospace face for small data labels
- `→` appended to link and button text
- accenting a single word in a headline
- fade-and-slide-up entrances on every section
