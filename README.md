# Chronological History

**Live: https://shivam1410.github.io/chronological-history/**

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

Two link fields, deliberately separate:

```yaml
  sources:                    # what backs the DATES
    - title: Encyclopaedia Britannica — Kabir
      url: https://www.britannica.com/biography/Kabir-Indian-mystic-and-poet
  texts:                      # where to READ the work itself
    - title: Bijak of Kabir (Ahmad Shah translation)
      url: https://archive.sacred-texts.com/hin/kabir/index.htm
```

A source has to be current scholarship; a text just has to be a faithful,
freely readable edition. Keeping them apart means an out-of-date translation can
still be linked for reading without being cited as evidence for a date.

Dates are always brackets, never bare guesses. `1526` means precisely 1526;
`[1398, 1440]` means somewhere in that window. Deep time uses `"66 Ma"`, `"4.54 Ga"`,
`"12 ka"` — thousands/millions/billions of years before 1950 CE.

Years use historical numbering: `-1` is 1 BCE, `1` is 1 CE, and **there is no year 0**.

`make build` refuses to emit if anything fails validation, so a bad date or a dangling
cross-reference stops the build rather than silently corrupting the timeline.

## How it was designed and built

The full planning record lives in [`docs/`](docs/) and is worth reading before
changing anything structural — particularly `spec.md`, which is the contract the
code is written against.

| Document | What it covers |
|---|---|
| [docs/prd.md](docs/prd.md) | Goal, scope, non-goals, acceptance criteria, risks |
| [docs/design.md](docs/design.md) | Screens, states, interaction rules, accessibility notes |
| [docs/spec.md](docs/spec.md) | Data model, the time-scale contract, bundle formats, decisions and the alternatives rejected |
| [docs/tasks.md](docs/tasks.md) | Phase-by-phase plan, with the validation each slice has to pass |
| [docs/execution.md](docs/execution.md) | What actually happened: save points, proofs, and every defect found and fixed |
| [docs/state.json](docs/state.json) | Machine-readable build state |

Two things in there are load-bearing and easy to break by accident:

- **The time scale is anchored, not plainly logarithmic.** A plain log gave the
  Pleistocene a third of the axis and all of recorded history a twelfth. See
  *Time scale contract* in [docs/spec.md](docs/spec.md).
- **There is no year zero.** `-1` is 1 BCE and `1` is 1 CE, so year arithmetic
  has to route through `astro()` / `elapsed()`. This has caused more bugs here
  than everything else combined.

## Nothing is fetched at render time

The deployed site makes exactly one kind of network request: three local JSON
files from its own origin. It never calls Wikidata, Wikipedia or Commons.

```
you run, on demand            committed to git              served as static files
──────────────────            ────────────────              ──────────────────────
make wikidata  ──┐
make cite      ──┼──query──▶  data/imported/*.yaml
make images    ──┘            site/images/*
                                      │
make build     ─────────merge─────────┴──▶  site/data/spine.json
                                            site/data/meta.json
                                            site/data/eras/*.json   ──▶  browser
```

Those fetch commands run on your machine when you choose. Their output is
committed, so the site is frozen between runs and works whether or not any
upstream service is up. CI rebuilds from `data/` on every push and fails if
`site/data/` has drifted, so a stale bundle cannot ship unnoticed.

Images are downloaded into `site/images/` rather than hotlinked, so a visitor's
browser never contacts Wikimedia either.

### The commands

| Command | Network | What it does |
|---|---|---|
| `make build` | no | Merge `data/` into the JSON the site reads |
| `make validate` | no | Check the sources without emitting |
| `make audit` | no | Report sourcing gaps and date disagreements |
| `make wikidata` | yes | Resolve entries to Wikidata items |
| `make cite` | yes | Resolve citations and check what they say |
| `make images` | yes | Resolve, download and credit images |

### How Wikidata is used

Entries are matched to Wikidata items by article title, and **only the
identifier is imported**. Dates are deliberately not applied over hand-authored
ones — they are used to *check* them, and `make audit` reports where the two
disagree. That comparison is the only independent check this dataset has on
dates that were written from recall.

Matching is strict: an item is accepted only when its title equals the entry's
own, ignoring case, accents and a leading article. No prefix matching, because
no string rule separates "Euclid" / "Euclid of Alexandria" from "Homer" /
"Homer Simpson". Roughly a third of entries are therefore left unmatched, which
is the right way to be wrong — a false positive imports another entity's dates
under our label.

It still gets things wrong. The check caught `bijak-kabir`, an entry about when
Kabir's collections were written down, matched to Kabir the person and offered
his lifespan instead.

## Where the data comes from — and how far to trust it

**Every entry was written from an AI model's knowledge. Nothing was scraped, and
no source was consulted while writing.** That is the single most important thing
to know about this dataset, so it goes first.

The reference works listed below are ones believed to support each claim. For
the most part they have **not** been fetched and checked line by line. The
`sources:` links are pointers for a reader who wants to verify, not evidence
that verification happened.

### What that means in numbers

Run `make audit` for the current state. At the time of writing:

| | |
|---|---|
| Entries | 390 |
| Carrying a source link | 87 (22%) |
| Marked `contested` | 67 |
| Marked `contested` with no citation | **0** |

Every contested entry now cites something. That is a lower bar than it sounds,
and the next section says why.

### A citation is not a verification

Sixty of those citations were added by `make cite`, which resolves each entry
to a Wikipedia article, follows redirects to the canonical title, and then
checks whether the article's own opening section mentions the dates this
dataset claims. Nothing is asserted without being fetched first.

The results are not uniformly reassuring, and are reported rather than hidden:

| Does the cited article's opening mention our dates? | Entries |
|---|---|
| Yes, both bounds | 12 |
| One bound | 13 |
| **Neither** | **22** |
| Not checkable — deep time, no bare years to match | 13 |

Those 22 are not necessarily wrong. An article's first paragraph often
summarises a subject without restating its dates, so this is a weak test that
produces false alarms. But they are the entries where this dataset's date and
its citation have not been shown to agree, and `make audit` lists them by name.

These are also **tertiary sources**. They point a reader at where a dispute is
documented; they are not evidence that the bracket here is the right one.

### A crude accuracy check

Twelve well-known date ranges were compared against the opening paragraph of
their Wikipedia article. Eleven were corroborated at least partly; one (the
Mughal Empire) was not, because that paragraph does not state the years — not
because the dates are wrong.

This catches grossly wrong dates. It does not catch subtle ones, and it was run
on twelve entries out of 390.

### How to use it, then

Treat this as an **orientation tool**, not a citable reference. It is good at
showing you that Kabir, the Ming, the Inca and the Renaissance overlapped, and
that the Pali Canon was written four centuries after the Buddha died. Before
repeating any specific date elsewhere, check it.

Contested material is bracketed widely and flagged rather than resolved, which
limits the damage a wrong recollection can do — a 200-year bracket is honest
about uncertainty in a way a single year is not.

### Reference works

Dates are written as brackets rather than single numbers, because most of
history does not have single numbers. Where scholarship genuinely disagrees —
Kabir's lifespan, the composition of the Rigveda, the Buddha's dates — the entry
carries a wide bracket, `confidence: contested`, a `note` naming the competing
positions, and at least one citation. The build refuses to emit an entry with a
bracket wider than 200 years that still claims `confidence: high`.

Reference works consulted for the current dataset:

| Source | Used for |
|---|---|
| [Encyclopaedia Britannica](https://www.britannica.com/) | Biographical and dynastic dates |
| [UNESCO World Heritage](https://whc.unesco.org/) | Monuments and archaeological sites |
| [USGS](https://www.usgs.gov/) | Geological dating and the Himalayan orogeny |
| [Natural History Museum](https://www.nhm.ac.uk/) | Palaeontology |
| [International Commission on Stratigraphy](https://stratigraphy.org/chart) | Epoch and period boundaries |

### Images

Fetched from **Wikimedia Commons** by `make images`, which reads each file's
licence and attribution from the Commons API rather than assuming them. An
image with no stated licence is refused. Credit and licence are displayed with
every picture, because most are CC BY-SA and that is a condition of use.

Which image suits an entry is a judgement and is curated by hand in
`pipeline/images.py`; what its terms are is a fact and is fetched.

### Planned, not yet used:

| Source | Planned use |
|---|---|
| [Internet Sacred Text Archive](https://archive.sacred-texts.com/) | `texts:` links to full public-domain translations — **not** for dates; its translations are from the 1880s–1910s and their chronologies are a century out of date |
| [Wikidata](https://www.wikidata.org/) | Breadth via SPARQL, with curated entries always winning on merge |

Where a religious tradition holds a text to be contemporaneous or eternal, the
`note` says so plainly rather than presenting the academic dating as settled.
This is a reference tool, not an argument.

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
| `docs/` | Planning artifacts: PRD, design, spec, tasks, execution log |
| `.github/workflows/` | CI (tests + data freshness) and GitHub Pages deploy |
