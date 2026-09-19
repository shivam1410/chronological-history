# Chronological History

An interactive timeline of everything — from the formation of the Earth 4.54 billion
years ago to the present day — built to make historical *simultaneity* visible.

Two ways to look at it:

- **Timeline.** Zoom and pan a continuous scale across deep time and recorded history,
  with parallel regional lanes so you can see what was happening everywhere at once.
- **Year slice.** Pick a year — say 1555 — and get a cross-section of every region:
  which empires stood, who was alive, what was being written.

Coverage is deliberately deep on the Indian subcontinent (Vedic period, scriptural
composition, Bhakti-era saints, dynasties, the Mughals) with enough world context that
any year shows meaningful parallels.

## Running it

```bash
make setup     # create .venv and install dependencies (once)
make build     # regenerate site/data/ from the YAML sources
make serve     # preview at http://localhost:8000
```

The site needs to be served over http — ES modules and `fetch` do not work from a
`file://` URL. `make serve` handles that.

```bash
make test      # pytest (pipeline) + node --test (pure JS modules)
make validate  # check the data sources without emitting
make stats     # coverage report: entries per lane per era, and gaps
```

## How it fits together

```
data/          YAML you edit by hand — the source of truth
   ↓  make build   (validate → merge → emit)
site/data/     generated JSON, committed, read by the browser
site/          static HTML/CSS/ES modules — no framework, no bundler
```

`site/data/` is **generated**. Never edit it directly; edit `data/` and rebuild.

The site has no backend and no runtime dependencies. Python builds the data; Node runs
unit tests for the pure JS modules. Neither is needed to *serve* the site — GitHub Pages
publishes `site/` as-is.

## Adding an entry

Add to the relevant file under `data/curated/`, then `make build`.

```yaml
- id: kabir
  title: Kabir
  kind: person
  regions: [north-india]
  start: [1398, 1440]        # bracketed — scholarship disagrees
  end: [1448, 1518]
  importance: 4
  confidence: contested
  note: Traditional dates give 1398–1518; most modern scholars prefer c. 1440–1518.
  summary: Poet-saint of the Bhakti movement whose couplets rejected both Hindu and
    Islamic orthodoxy in favour of direct devotion.
  categories: [saint, poet]
  aliases: [Kabir Das, Bhagat Kabir]
  sources:
    - title: Encyclopaedia Britannica — Kabir
      url: https://www.britannica.com/biography/Kabir-Indian-mystic-and-poet
```

Dates are always brackets, never bare guesses. `1526` means precisely 1526;
`[1398, 1440]` means somewhere in that window. Deep time uses `"66 Ma"`, `"4.54 Ga"`,
`"12 ka"` — thousands/millions/billions of years before 1950 CE.

Years use historical numbering: `-1` is 1 BCE, `1` is 1 CE, and **there is no year 0**.

`make build` refuses to emit if anything fails validation, so a bad date or a dangling
cross-reference stops the build rather than silently corrupting the timeline.

## Layout

| Path | What |
|---|---|
| `data/curated/` | Hand-authored entries, one file per theme |
| `data/taxonomy/` | Regions (lanes), kinds, categories |
| `data/imported/` | Wikidata import output, committed |
| `pipeline/` | Python: load → merge → validate → emit |
| `site/` | The deployable static site |
| `site/js/*.test.js` | Unit tests for the pure modules, via `node --test` |
| `tests/` | pytest suite for the pipeline |
| `.aw_docs/features/` | Planning artifacts: PRD, design, spec, tasks |
