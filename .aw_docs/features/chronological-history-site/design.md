# Design — Chronological History Site

## Routes / flows

Single page, state encoded in the URL hash so any view is linkable and bookmarkable.

```
#/timeline?from=-4540000000&to=2026&lanes=india,europe&q=
#/timeline?from=1500&to=1600&focus=kabir
#/year/1555
#/entry/mughal-empire
```

Hash changes are the single source of truth for view state. Back/forward work.

## Screens

### 1. Timeline (default)

```
┌──────────────────────────────────────────────────────────────┐
│ ⌕ search           [Ga][Ma][ka][BCE][CE] era jumps    ☰ filt │  header, 48px
├──────────────────────────────────────────────────────────────┤
│  4.54 Ga        541 Ma      66 Ma    12 ka   1 CE      2026  │  axis, 32px
├────────────┬─────────────────────────────────────────────────┤
│ Earth&Life │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░                         │
│ India      │                        ▓▓▓▓ ▓▓▓▓▓▓  ▓▓▓         │  lanes,
│ East Asia  │                         ▓▓▓▓▓▓  ▓▓▓▓▓▓          │  canvas
│ West Asia  │                        ▓▓▓  ▓▓▓▓▓▓▓             │
│ Europe     │                          ▓▓▓▓▓▓▓▓ ▓▓▓           │
│ …          │                                                 │
├──────────────────────────────────────────────────────────────┤
│ minimap: full 4.54 Ga range with current window highlighted  │  36px
└──────────────────────────────────────────────────────────────┘
```

- Lanes are collapsible region groups. `India` expands into North / South / Deccan /
  Himalaya sub-lanes when the window is narrower than ~2000 years.
- Within a lane, overlapping entries stack into sub-rows (first-fit packing).
- Bar height 14 px, 3 px gap. Lane height grows with its sub-row count.
- Point events (single year) draw as a 3 px diamond mark, not a bar.

### 2. Detail panel

Slides in from the right (bottom sheet under 768 px). Shows title, kind badge, date
display string, confidence badge when not `high`, summary, significance, region chips,
category chips, related entries as clickable chips, source links, and a Wikidata link
when present. Escape or the close button dismisses it and restores hash to the timeline.

### 3. Year slice

Entered via `#/year/1555`, the year input in the header, or double-clicking the axis.

```
        ── 1555 CE ──   [◀ −10] [◀ −1]  [+1 ▶] [+10 ▶]     [view on timeline]

  Indian Subcontinent
    ▸ Mughal Empire                 1526 – 1857     (year 29 of 331)
    ▸ Humayun recovers Delhi        1555            ● this year
    ▸ Tulsidas                      c.1511 – 1623   (age c. 44)
    ▸ Sur Empire                    1540 – 1556
  West Asia & Persia
    ▸ Safavid Empire                1501 – 1736
    ▸ Peace of Amasya               1555            ● this year
  Europe & Mediterranean
    ▸ Peace of Augsburg             1555            ● this year
  …
```

- Ongoing entries show elapsed position ("year 29 of 331"); people show age.
- Entries starting or ending exactly in the queried year are marked and sorted first.
- Region groups are ordered by the user's lane ordering; empty regions are hidden.

## States

| State | Behavior |
|---|---|
| Initial load | Skeleton axis + "Loading…" in lane area; spine fetched; first render |
| Load failure | Inline error card with the failing URL and a retry button; no silent failure |
| Empty filter result | "No entries match these filters" with a one-click reset |
| Detail not yet fetched | Panel opens immediately with spine data; summary area shows a shimmer until its era bundle resolves |
| Detail fetch failure | Panel keeps spine data and shows "Details unavailable — retry" |
| Zoomed past data density | Labels drop by importance tier; a "+N more" count appears per lane sub-row |

## Interaction rules

| Input | Action |
|---|---|
| Wheel / trackpad scroll | Zoom about the cursor's year position |
| Shift + wheel, or drag | Pan |
| Pinch | Zoom about the pinch midpoint |
| Click entry | Open detail panel, set `#/entry/<id>` |
| Double-click axis | Open year slice for that year |
| `/` | Focus search |
| `←` `→` | Pan one-tenth of the window |
| `+` `−` | Zoom |
| `Home` | Reset to the full 4.54 Ga view |
| `Esc` | Close panel or clear search |
| `Tab` | Move through lane headers, then visible entries in time order |
| `Enter` on a focused entry | Open its detail panel |

Zoom is clamped: minimum window 1 year, maximum the full range. Panning is clamped to
the data extent plus 5% padding.

## Accessibility notes

- The canvas is decorative-with-fallback: a visually hidden but focusable `<ul>` mirrors
  the visible entries in time order with real links, so screen readers and keyboard users
  get the same content. It is rebuilt on every view change (capped at 300 items, with a
  count announced when truncated).
- The detail panel is a focus-trapped `role="dialog"` with `aria-labelledby` on its title;
  focus returns to the invoking element on close.
- View changes announce via a polite live region: "Showing 1500 to 1600 CE, 84 entries".
- All colors meet WCAG AA against their background in both themes; lane identity is
  carried by color *and* by the lane label, never color alone. Confidence is shown with
  a text badge, not only a faded edge.
- Honors `prefers-reduced-motion` by disabling zoom easing and panel slide transitions.
- Minimum hit target 24 px: thin bars get an invisible padded hit box.

## Theming

CSS custom properties on `:root`, redefined under
`@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`. Dark is the
default look for the timeline surface. A manual toggle persists to `localStorage`
inside `try/catch`, since storage can throw in private mode.

Lane palette: ten hues chosen for distinguishability under protanopia and deuteranopia,
defined once in `css/tokens.css` as `--lane-<id>`.

## References to `designs/`

No static mockups. The ASCII layouts above plus `css/tokens.css` are the design
contract; the built page is the reference implementation.
