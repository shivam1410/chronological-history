# Execution — Chronological History Site

## Phase 1 — Walking skeleton (complete)

Route `/aw:build` · mode `code` · sequential, with one bounded parallel pair
(`p1-content` data authoring alongside `p1-frontend` pure modules).

| Slice | Save point | Proof |
|---|---|---|
| 1.1 Repo skeleton | `e1129a9` | `make test` exits 0 on an empty suite |
| 1.2 Model + fuzzy dates | `22604a9` | RED on `No module named pipeline.model` → 33 GREEN |
| 1.2 review fixes | `bbbf37b` | 4 RED regressions → GREEN |
| 1.3 Taxonomy + seed | `e8a4120` | 59 entries parse, no dangling `related` |
| 1.4 Loader + emit | `5534590` | RED on missing modules → 85 GREEN; build byte-stable |
| 1.4 review fixes | `4daa674` | 8 RED strictness regressions → 95 GREEN |
| 1.5 Time scale | `19f9126` | RED on missing modules → 48 GREEN |
| 1.6 Canvas timeline | `b422520` | axis-only screenshot → bars; drawn x == `view.project` |

Final state: **95 pytest + 67 node:test, all green.** `make build` emits 59 entries
across 18 era bundles; `spine.json` is 6.0 KB raw / 2.0 KB gzipped (~100 B per entry,
so ~400 KB gzipped at 20,000 entries — inside the 600 KB budget).

### Pre-change proof for non-test-first slices

1.6 is canvas pixel output and pointer input, which cannot be asserted without a
headless browser harness — an npm dependency the zero-dependency constraint rules out.
Proof taken instead, as `tasks.md` requires:

- **Before:** rendered the axis only, no bar-drawing code present. Screenshot showed
  ticks and guides against an empty stage.
- **After:** bars drawn; asserted in the browser that `item.x0 === view.project(entry.sMin)`
  to within 1e-9 for `mughal-empire`, `kabir`, `dinosaur-era`, `earth-formation` and
  `moon-landing` — all five exact. Zoom clamps verified at both ends (min window exactly
  1 year after 30 halvings; max window exactly the full range after 40 doublings). Axis
  units verified across six scales. Console clean.

### Defects found and fixed inside the phase

Six, all caught by review or by running the thing:

1. **`Bound.width` bypassed `astro()`** (1.2 review, blocking) — raw historical
   subtraction over-counted by one for any bracket straddling the BCE/CE boundary.
   The Phase 4 rule that flags over-wide brackets consumes `.width`, so this would have
   surfaced as silently mis-flagged entries.
2. **Negative deep-time magnitudes parsed** (1.2 review) — `"-66 Ma"` yielded a year
   ~66 million CE instead of raising.
3. **Loader strictness was promised but not enforced** (1.4 review, blocking) — a stray
   non-mapping YAML item raised `AttributeError`; `regions: []` blew up later in emit
   with a bare `IndexError` naming neither file nor entry; a blank `title:` became the
   literal string `"None"` and rode through to the timeline.
4. **`createView` projected in raw `sp`-space** (1.6, blocking, architectural) — bypassed
   the anchors, handing recorded history ~12% of the axis: the pure-log behaviour the
   anchors exist to prevent. `spec.md` said to do this and has been corrected.
5. **Deep-time ticks collapsed onto the present** (1.6) — snapping step exceeded the
   sample's own magnitude, rounding to zero.
6. **Tick sequences had holes** (1.6) — edge samples halved a gap they span once, so
   narrow windows read `1553 1554 1556`.

Each fix landed with a failing test first.

### Simplification applied

- Reversed-bracket enforcement moved from `parse_bound` into `Bound.__post_init__`:
  one enforcement point instead of two, and direct construction is now covered.
- `bucket_for` computed once per entry in `write_bundles`, not twice.
- `timeline.describe()` deleted rather than kept as a second copy of the same formatting
  that `main.js` needs anyway.
- `color-mix()` inside a canvas gradient stop replaced with hex alpha — an unparseable
  colour makes `addColorStop` throw, which aborts the whole frame.
- Dead `globalAlpha` assignments removed from the label path.
- Unused `taxonomy` binding dropped from `cmd_validate`.

### Deferred, with rationale

- **Advisory: `Bound` accepts an empty explicit `display`**, falling through to the
  derived string. Deferred: deriving is the forgiving and useful behaviour for a blank
  `display:`, and rejecting it would add code for no gain.
- **Advisory: float `importance`** — now rejected outright rather than truncated, so this
  one was taken rather than deferred.

## Next

Phase 2 — timeline depth. Slice 2.1 (`layout.js` first-fit lane packing) is the entry
point and replaces `PLACEHOLDER_ROWS` in `timeline.js`.
