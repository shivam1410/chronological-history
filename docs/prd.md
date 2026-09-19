# PRD — Chronological History Site

## Goal

A dependency-free static website that lets one person explore history as a single
continuous timeline — from the formation of the Earth to the present day — and answer
two questions well:

1. **"Show me everything."** Zoom and pan a visual timeline spanning 4.54 billion years
   to today, with parallel regional lanes so simultaneity is visible at a glance.
2. **"What was happening in year X?"** Pick a year or range (e.g. 1555 CE) and get a
   cross-section listing what was underway in every region at that moment — which
   empires stood, who was alive, what was being written.

The site is the user's personal reference tool. No accounts, no backend, no analytics.

## Target user

A single reader (the repo owner) who wants to build intuition for historical
simultaneity, with particular interest in Indian chronology — Vedic period, epic and
scriptural composition dates, Bhakti-era saints, dynasties, the Mughal Empire — set
against world context.

## Scope

- Static site served from GitHub Pages. HTML/CSS/vanilla ES modules only, no framework,
  no npm dependency at runtime or build time for the site itself.
- A Python data pipeline that validates human-authored source data, optionally merges
  Wikidata-imported data, and emits optimized JSON bundles into the served site.
- A curated core dataset emphasizing the Indian subcontinent with sufficient global
  coverage that any year from roughly 3000 BCE onward shows meaningful parallels.
- A Wikidata SPARQL importer for breadth, with curated entries always taking precedence.
- Deep-time coverage: planetary formation, major geological and biological eras,
  mass extinctions, Himalayan orogeny, Pleistocene glaciations, human dispersal.
- Uncertainty is first-class: every date is a bracketed range with a display label, so
  "Kabir, c. 1398–1518" and "Ramayana, composed c. 500 BCE – 200 CE" are both
  representable and visually distinguishable from precise dates.

## Non-goals

- No backend, database server, authentication, or user-generated content.
- No editing UI. Data is edited as files in the repo.
- No map view, no genealogy trees, no image galleries in the initial build.
- No attempt to adjudicate contested chronologies. Where scholarship disagrees
  (e.g. Vedic dating, epic composition, Kabir's lifespan), the entry carries a wide
  bracket, a `contested` confidence flag, and a note naming the competing views.
- Not a general-purpose Wikipedia mirror. Imported breadth is filtered and capped.

## Assumptions and constraints

- Served over `http(s)`; ES modules and `fetch` will not work from `file://`.
  Local preview uses `python3 -m http.server`.
- GitHub Pages serves static files with gzip; no server-side compression config needed.
- Generated JSON bundles are committed to the repo so the site never requires the
  pipeline to run at deploy time.
- Python 3.14 and Node 20 are available locally. Node is used only to run unit tests
  for pure JS logic via the built-in `node:test` runner — never as a site dependency.
- Wikidata's SPARQL endpoint requires a descriptive User-Agent and tolerates only modest
  query rates; the importer caches raw responses and is never run during a page load.
- Target first-paint payload under 600 KB gzipped at 20,000 entries.

## Acceptance criteria

1. Opening the site shows a timeline covering 4.54 Ga to the present; scroll/pinch zooms
   smoothly into any span down to a single year, and the axis labels switch units
   (Ga / Ma / ka / BCE / CE) appropriately at each scale.
2. Entries render as horizontal bars grouped into regional lanes; point events render as
   marks. Uncertain start/end bounds render with a visibly faded edge.
3. Clicking any entry opens a detail panel with title, date display string, summary,
   region, category, related entries, and source links.
4. Entering `1555` in the year-slice view lists, grouped by region, everything active in
   that year — including the Mughal Empire, Humayun's return and Akbar's accession,
   Tulsidas's lifetime, and simultaneous entries from at least four other regions.
5. Searching `Kabir` finds the entry and jumps the timeline to his lifespan.
6. Every question in the original request is answerable from the shipped dataset:
   Ice Age extents, dinosaur era, Himalayan orogeny, Mughal Empire span, Kabir,
   Tulsidas, and Ramayana composition.
7. `pytest` passes for the pipeline; `node --test` passes for pure JS modules.
8. The pipeline rejects malformed data with an actionable error naming the file,
   entry id, and failing rule — it never emits a bundle from invalid input.
9. The site is usable at 390 px width and via keyboard alone; it respects
   `prefers-color-scheme` and `prefers-reduced-motion`.

## Risks, mitigations, dependencies

| Risk | Mitigation |
|---|---|
| Linear time is unusable across 4.5 Ga | Piecewise-logarithmic time scale as a pure, unit-tested module (`timescale.js`) |
| BCE/CE arithmetic off-by-one (no year zero) | Single conversion boundary to astronomical numbering, covered by explicit tests |
| Wikidata import floods the set with noise | Topic-scoped SPARQL queries, importance filter, hard per-query cap, curated-wins merge |
| Indian chronology is contested and politically charged | Wide brackets, `contested` confidence, explicit note naming competing scholarly positions, sources on every contested entry |
| Payload growth as the dataset grows | Spine/detail split; detail bundles bucketed by era and lazily fetched; documented perf checkpoint |
| Canvas redraw jank with 20k entries | Render only the visible window; per-lane interval index; redraw on change, not per frame |
