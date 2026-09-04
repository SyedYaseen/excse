# Design

Produced with the `frontend-design` skill. Extend this rather than drifting back to defaults.

## Grounding

One person, at home, on a phone, mid-workout, answering *"what haven't I done yet?"* in under
two seconds with one thumb. Not a gym-bro app (no chrome, no neon, no BEAST MODE), not a
clinical health dashboard. The nearest real-world object is a **tally sheet** — quiet,
repetitive, unglamorous, about accumulation over time. Every choice below comes from that.

## Hierarchy: four steps and nothing else

The first version was minimal and had no hierarchy at all: a `.category-head` was
`1rem/600` against a `1rem/400` exercise name, with no rule, no size step and 24px of margin
between groups. The whole Today screen was one undifferentiated column of 16px text, and the
eye had nowhere to land. Minimal is right; flat is not.

The screen now has exactly four type steps, tokenised in `theme.css` so they cannot drift back
into scattered rem literals:

```
--t-hero  2.5rem     the count -- the loudest thing in the app
--t-title 1.1875rem  a muscle group
--t-row   1.0625rem  an exercise
--t-meta  0.8125rem  counts, labels, the skip badge
```

The reading order is deliberate and always the same:

1. **`28 left`** at the top, in the hero step. Mid-workout, one thumb, the first question is
   how much is left, and the answer should not have to be read.
2. **The accented group heading** — the one the ordering rules would have you do next. It is an
   underline rather than a badge or a fill, so it can move between groups without shifting a
   single row.
3. **The rows**, tracked left to right by a hairline inset to the text column.

Group headings are **sticky** under the 2px progress rail. In a list of forty exercises the
easiest thing to lose is which muscle group you are in; the heading simply never leaves.

Rows are 52px with `white-space: nowrap` and an ellipsis. Previously `.exercise-name` had
neither, so a long name wrapped to a second line -- and with no separators between rows, one
wrapped exercise was indistinguishable from two adjacent ones. That is the "double lines"
problem, and it was two problems: this one, and the literal double rule below.

## The whole row is the control

`<button role="checkbox">` wraps the tally, the name and the badge. Tapping the name strikes it
out exactly like tapping the glyph. Aiming a thumb at a 22px mark between sets is not a
gesture anyone actually makes, and the strike-through is the thing people read anyway.

## The one bold move: the tick *is* a tally mark

Not a rounded square with a checkmark. Each exercise carries a single vertical stroke; tapping
draws a diagonal slash through it — the tally gesture — and strikes through the name. You are
literally making a mark on a sheet. One glyph, readable at arm's length, and it scales from the
daily band to the year view.

Everything else stays quiet. Boldness is spent here and nowhere else.

The glyph itself is decorative (`aria-hidden`); the row around it is the
`<button role="checkbox" aria-checked>`, giving a full-width hit area, native Space/Enter
handling and a visible focus ring. A custom tick glyph is the easiest place in this design to
accidentally ship something unusable by keyboard or screen reader.

## Tokens

**Color.** Ground is a pale cool chalk-grey. The accent appears in exactly three places: the
cycle button, today's marker on the calendar, and the underline on the group to do next.
Completion reads as strike-through and dimming, not colour, so the palette stays almost
monochrome. A fourth token, `--hair`, is a lighter-than-`--rule` line used between rows: a list
should read as one block with tracks through it, not a stack of separate things.

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

The daily band sits on **its own ground tone** with its own label. It used to be separated by a
double rule -- two hairlines 3px apart, meant to encode "above resets nightly, below persists"
without a label. On a phone that read as one slightly thick line, said nothing, and looked like
a mistake. A tinted full-bleed band is not a card (no radius, no shadow, no border) and needs
no explaining.

```
 ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░   ← progress rail, 2px, sticky

 11 left            Next up: Legs    ← the eye lands here first
 Cycle 3                  Re-sort

┌─────────────────────────────────┐
│ Every day                   1/6 │  ← tinted band, full bleed
│ ╱│ Crunches   ╱ ╱ ╱ · ╱ ╱ ╱     │
│  │ Plank      · ╱ ╱ · ╱ ╱ ╱     │
│  │ Pull up    ╱ · ╱ ╱ · · ╱     │
└─────────────────────────────────┘

 Legs                          0/5
 ═════════════════════════════════   ← accent underline: do this next
   │  Squat            skipped twice
   ──────────────────────────────
   │  Split squat
   ──────────────────────────────
   │  Lunges

 Core                          1/3
 ─────────────────────────────────
  ╱│  Leg raises
   │  Plank arm thing
 ─────────────────────────────────
 Done this cycle
  Chest                        4/4
```

## The year view is the payoff

The permanent `active_days` record renders as 52 columns of 7 tally strokes — a wall of marks
accumulated over a year. Not GitHub squares, which is the default and would undercut the
metaphor. This is the emotional payload of the whole brief, so it gets the strongest single
image in the app.

## The order holds still

The ordering rules are the reason this app exists, but running them after every tick meant the
row below the one you just tapped slid up into its place immediately -- a double-tap waiting to
happen, and it lost your place in the muscle group you were working through.

So the rules run **when you ask**: on open, on a new day, on a new cycle, and on `Re-sort`.
Between those, nothing moves. A group you finish now reads as done where it stands and only
collapses into the completed zone at the next sort. `Next up: Legs` is read live from the same
rules and scrolls you there — naming the next group is free, moving it is not.

## Motion

One orchestrated moment, answering a user action: on tick the slash strokes in over ~140ms and
the name strikes through. Nothing else moves, by design — see above. No page-load fades, no
per-row hover transitions. `prefers-reduced-motion` drops all of it to instant state changes.

## Copy

Plain, active, from the user's perspective, each element doing one job.

- Complete → `Start cycle 4`. Incomplete → `End cycle early`.
- Confirm sheet: *"Superman, Bird dog and 3 more will carry to the top of your next cycle."*
- Unsynced: *"Not saved yet"* — what the user cares about, not "Offline".
- Login failure: *"Wrong username or password."* No apology, not vague.
- Empty state: *"Add the exercises you can do at home. You'll tick them off as you go."*
- The calendar's rule, stated rather than hidden: *"A day marks itself once you have done 4
  exercises outside the daily band. Tap any day to mark it yourself."*

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
- a card per list item (the hairlines do the same job with none of the weight)
