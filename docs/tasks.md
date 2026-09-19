# Tasks — Chronological History Site

## Spec Brief

**Feature goal.** A dependency-free static site that renders all of history — 4.54 Ga to
today — as a zoomable timeline with regional lanes, plus a "what was happening in year X"
cross-section view. Data is hand-authored YAML plus Wikidata imports, compiled by a
Python pipeline into JSON bundles committed alongside the site.

**Architecture summary.** `site/` is pure HTML + CSS + vanilla ES modules with a canvas
timeline; pure logic (`timescale`, `layout`, `slice`, `search`, `format`) is separated
from rendering and unit-tested with `node --test`. `pipeline/` is Python: load YAML →
merge imports (curated wins) → validate → emit `meta.json`, `spine.json`, `eras/*.json`
into `site/data/`, tested with pytest. GitHub Actions runs both suites and publishes
`site/` to Pages.

**Execution route:** `/aw:build`
**Execution mode:** sequential across phases; `parallel_candidate` marked per slice.
**Chunk review mode:** review at each phase boundary (6 review points).
**max_parallel_subagents:** 3

## File structure

### Create — pipeline
| File | Responsibility |
|---|---|
| `pipeline/model.py` | `Bound`, `Entry`, `Source` dataclasses; year-numbering conversion; deep-time and shorthand date parsing; display-string derivation |
| `pipeline/loader.py` | Read `data/taxonomy/*.yaml`, `data/curated/*.yaml`, `data/imported/*.json` into `Entry` objects |
| `pipeline/validate.py` | The twelve validation rules from `spec.md`; raises `ValidationError` naming file, id, rule |
| `pipeline/merge.py` | Drop imported entries colliding with curated (Qid, then normalized title + overlapping bracket); return kept entries + collision report |
| `pipeline/emit.py` | Era bucketing; write `meta.json`, `spine.json`, `eras/*.json` deterministically |
| `pipeline/wikidata.py` | SPARQL client with User-Agent, paging, on-disk response cache, normalization to `Entry` |
| `pipeline/cli.py` | `build`, `validate`, `import`, `stats` subcommands + build summary table |

### Create — site
| File | Responsibility |
|---|---|
| `site/index.html` | Document shell, header, canvas, panel and year-view containers, live region |
| `site/css/tokens.css` | Color/space/type custom properties, lane palette, light+dark |
| `site/css/layout.css` | Page grid, header, minimap, responsive breakpoints |
| `site/css/timeline.css` | Lane headers, axis, canvas sizing |
| `site/css/panel.css` | Detail panel and year-slice styling |
| `site/js/format.js` | PURE — year/era/duration/age display strings, no-year-zero arithmetic |
| `site/js/timescale.js` | PURE — `yearToUnit`/`unitToYear`, `createView`, project/unproject, zoom/pan, tick ladder |
| `site/js/layout.js` | PURE — first-fit lane sub-row packing, visible-window culling, row cap + hidden count |
| `site/js/slice.js` | PURE — `activeIn(spine, year)`, `groupByLane`, boundary marking, ranking |
| `site/js/search.js` | PURE — title/alias matching, prefix > substring ranking, importance tiebreak |
| `site/js/store.js` | Fetch + cache `spine.json` and era bundles; error surfaces, never silent |
| `site/js/router.js` | Hash ↔ view state, back/forward |
| `site/js/timeline.js` | Canvas renderer, DPR handling, hit testing, pointer + wheel input |
| `site/js/panel.js` | Detail panel DOM, focus trap |
| `site/js/yearview.js` | Year-slice DOM |
| `site/js/a11y.js` | Hidden mirror list, live-region announcements, focus management |
| `site/js/main.js` | Bootstrap and wiring only |

### Create — data & infra
`data/taxonomy/{regions,categories,kinds}.yaml`, `data/curated/*.yaml` (Phase 3),
`Makefile`, `README.md`, `.gitignore`, `.github/workflows/{ci,pages}.yml`,
`pytest.ini`, `requirements.txt` (PyYAML + requests only).

### Create — tests
`tests/test_{model,loader,validate,merge,emit,wikidata,cli}.py`,
`tests/fixtures/`, and `site/js/{format,timescale,layout,slice,search}.test.js`.

---

## Phase 1 — Walking skeleton

**Outcome:** `make build && make serve` renders ~30 real entries as bars on a zoomable
canvas in the browser. End to end, thin, everything after this is depth.

### 1.1 Repo skeleton · `infra`
- Files: `.gitignore`, `README.md`, `requirements.txt`, `pytest.ini`, `Makefile`
- [ ] `git init`, set default branch `main`
- [ ] `.gitignore`: `__pycache__/`, `.venv/`, `data/imported/.cache/`, `.DS_Store`
- [ ] `requirements.txt`: `PyYAML`, `requests`
- [ ] `Makefile` targets `build`, `validate`, `test`, `test-py`, `test-js`, `serve`, `stats`
- [ ] `README.md`: what it is, how to run, how to add an entry
- Acceptance: `make test` runs both suites (empty is fine) and exits 0
- Validation: `make test && echo OK`
- Commit: `chore: scaffold repo, make targets, and test harness`
- Size: S

### 1.2 Year numbering + fuzzy dates · `code` · RED → GREEN
- Files: `pipeline/model.py`, `tests/test_model.py`
- [ ] RED: write `tests/test_model.py` asserting `astro(-1) == 0`, `astro(1) == 1`,
      `duration(-1, 1) == 2`, `parse_bound(1526) == Bound(1526,1526,"1526")`,
      `parse_bound([1398,1440]).display == "c. 1398–1440"`,
      `parse_bound("66 Ma").min == -65_998_051`, `parse_bound("4.54 Ga").display == "4.54 Ga"`,
      `parse_bound("12 ka").min == -10_051`
- [ ] Run `make test-py` — confirm it fails on import of `pipeline.model`
- [ ] GREEN: implement `Bound`, `Source`, `Entry`, `astro`, `historical`, `duration`,
      `parse_bound`, `derive_display`
- [ ] Run `make test-py` — confirm green
- [ ] REFACTOR: extract the deep-time suffix table to a module constant
- Acceptance: every date shorthand in `spec.md` parses; the -1 → 1 boundary is covered
- Validation: `make test-py`
- Commit: `feat(pipeline): entry model with no-year-zero arithmetic and fuzzy dates`
- Size: M

### 1.3 Taxonomy + 30-entry seed · `docs`
- Files: `data/taxonomy/{regions,categories,kinds}.yaml`, `data/curated/seed.yaml`
- [ ] `regions.yaml`: the ten lanes from `design.md`, each with label, order, color token,
      and sub-regions for `india`
- [ ] `kinds.yaml`: person, work, polity, event, period, geological, biological,
      structure, movement, technology
- [ ] `categories.yaml`: ~25 starting categories (scripture, empire, battle, dynasty,
      extinction, glaciation, orogeny, saint, poet, astronomy, …)
- [ ] `seed.yaml`: the seven entries from the original request — earth-formation,
      dinosaur era, Cretaceous–Paleogene extinction, last glacial period, Himalayan
      orogeny, Mughal Empire, Kabir, Tulsidas, Ramayana composition — plus ~20 more
      spanning every lane, each with summary, sources, and honest confidence flags
- Acceptance: file parses; the original request's seven questions are all answerable
- Validation: `python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('data/**/*.yaml',recursive=True)]"`
- Commit: `feat(data): region/kind/category taxonomy and 30-entry seed`
- Size: M
- `parallel_candidate: true` · `parallel_group: p1-content` · `parallel_write_scope: data/`
- `parallel_ready_when: 1.2 has landed (Bound shorthand is fixed)`

### 1.4 Loader + minimal emit · `code` · RED → GREEN
- Files: `pipeline/loader.py`, `pipeline/emit.py`, `pipeline/cli.py`,
  `tests/test_loader.py`, `tests/test_emit.py`, `tests/fixtures/mini.yaml`
- [ ] RED: tests asserting the loader returns N `Entry` objects from `fixtures/mini.yaml`
      with taxonomy resolved, and that emit writes `meta.json` + `spine.json` +
      `eras/<bucket>.json` with the exact `fields` array from `spec.md`
- [ ] Run `make test-py` — confirm RED
- [ ] GREEN: implement `loader.load_all`, `emit.bucket_for`, `emit.write_bundles`,
      `cli.build`
- [ ] Run `make test-py` — confirm green
- Acceptance: `make build` writes `site/data/` from the real seed; rerunning is
  byte-identical apart from the `generated` timestamp
- Validation: `make build && python3 -c "import json;d=json.load(open('site/data/spine.json'));print(len(d['rows']))"`
- Commit: `feat(pipeline): load sources and emit spine/meta/era bundles`
- Size: M

### 1.5 Time scale · `code` · RED → GREEN
- Files: `site/js/timescale.js`, `site/js/timescale.test.js`, `site/js/format.js`,
  `site/js/format.test.js`
- [ ] RED: `timescale.test.js` asserting `unitToYear(yearToUnit(y))` is within 1e-4
      years for `[-4.54e9, -66e6, -2.58e6, -11700, -500, 1, 1555, 1950, present]`;
      strict monotonicity over ~9000 sampled years spanning the full domain;
      `yearToUnit(-4.54e9) === 0`; `yearToUnit(present) === 1`; each anchor lands on its
      declared unit; the measured budget matches spec (recorded history 48% ±0.5,
      Pleistocene 12% ±0.5); `createView(1500,1600,1000).project(1550)` lands mid-width
      ±2 px; `zoomAbout` keeps the year under the cursor fixed to ±0.5 px; `ticks()`
      returns ≤ 12 entries at six zoom levels with labels `4.54 Ga`, `66 Ma`, `12 ka`,
      `500 BCE`, `1555`
- [ ] Run `make test-js` — confirm RED
- [ ] GREEN: implement `format.js` then `timescale.js`
- [ ] Run `make test-js` — confirm green
- [ ] REFACTOR: hoist `S_ORIGIN`/`S_NOW` to computed module constants
- Acceptance: round-trip error under 1 year at every tested scale
- Validation: `make test-js`
- Commit: `feat(site): piecewise-log time scale and display formatting`
- Size: M
- `parallel_candidate: true` · `parallel_group: p1-frontend` · `parallel_write_scope: site/js/`
- `parallel_ready_when: 1.1 has landed`

### 1.6 Minimal canvas render · `code`
- Files: `site/index.html`, `site/css/{tokens,layout,timeline}.css`,
  `site/js/{store,timeline,main}.js`
- [ ] `store.js`: fetch `data/spine.json` + `data/meta.json`, expose rows, surface errors
- [ ] `timeline.js`: DPR-aware canvas, draw axis ticks, draw one flat row of bars,
      wheel-to-zoom about the cursor, drag-to-pan
- [ ] `main.js`: wire store → view → renderer
- [ ] `make serve`, open `http://localhost:8000`, confirm the seed renders and zooms
- **Test-first not meaningful here.** This slice is canvas pixel output and pointer input. Asserting on drawn pixels would require a headless browser harness, which means an npm dependency the zero-dependency constraint rules out. The logic underneath it (`timescale`) is already fully unit-tested in 1.5.
  - Pre-change proof: `make serve` on the seed with `timeline.js` stubbed to draw only the axis — capture a screenshot showing ticks but no bars.
  - Post-change validation: Same view with bars drawn; confirm each seed entry's left edge sits at `view.project(entry.sMin)` by logging three entries' computed x against their drawn x and asserting equality in the console.
- Acceptance: PRD criterion 1 partially met — full range visible, zoom reaches one year,
  axis units switch correctly. No lanes yet.
- Validation: manual browser check + `make test`
- Commit: `feat(site): canvas timeline with zoom, pan, and adaptive axis`
- Size: M

**Phase 1 review point.** Confirm: round-trip precision, no-year-zero handling, byte-stable build.

---

## Phase 2 — Timeline depth

**Outcome:** lanes, stacked bars, uncertainty rendering, hit testing, detail panel,
minimap, and the URL as the source of truth.

### 2.1 Lane packing · `code` · RED → GREEN
- Files: `site/js/layout.js`, `site/js/layout.test.js`
- [ ] RED: tests for disjoint intervals → 1 row; two overlapping → 2 rows; nested
      intervals; an interval spanning the whole window; row cap 6 producing a `hidden`
      count; the 4 px minimum gap converted through the view
- [ ] Run `make test-js` — confirm RED, then implement, confirm green
- Acceptance: packing is stable (same input → same rows) and never drops silently
- Validation: `make test-js`
- Commit: `feat(site): first-fit lane packing with row cap and overflow count`
- Size: S

### 2.2 Lane rendering + uncertainty · `code`
- Files: `site/js/timeline.js`, `site/css/timeline.css`
- [ ] Draw lane headers, lane bands, per-lane packed sub-rows
- [ ] Point events as diamonds; uncertain bounds as a gradient-faded edge
- [ ] Label when bar width allows, else drop by importance tier; per-row "+N more"
- [ ] Collapse/expand lanes; auto-expand `india` sub-lanes below a 2000-year window
- **Test-first not meaningful here.** Lane geometry is already unit-tested in 2.1 (`layout.js`); what remains is drawing, which is pixel output.
  - Pre-change proof: Screenshot at each of the four target windows before lane rendering lands, showing the single flat row from 1.6.
  - Post-change validation: Same four windows after; assert `packLane` row counts logged per lane match the rows visibly drawn, and that every seed entry appears in exactly one row or in a `+N more` count — total drawn + hidden equals total culled-visible.
- Acceptance: PRD criteria 1 and 2 met
- Validation: manual browser check at full range, 1 Ma, 3000 BCE–2026, 1500–1600
- Commit: `feat(site): regional lanes, uncertainty edges, and label density tiers`
- Size: M

### 2.3 Hit testing + detail panel · `code`
- Files: `site/js/{timeline,panel,router,store}.js`, `site/css/panel.css`
- [ ] Per-lane interval index for O(log n) hit testing; 24 px padded hit boxes
- [ ] `store.loadEra(bucket)` with in-memory cache and a failure path
- [ ] Panel renders spine data immediately, fills prose when the era bundle resolves
- [ ] `router.js`: `#/timeline?from&to`, `#/entry/<id>`; back/forward restore the view
- **Test-first not meaningful here.** Hit testing is geometry over DOM and canvas coordinates; routing is `location.hash` side effects. Both sit at the I/O boundary by design.
  - Pre-change proof: With hit testing stubbed to return null, confirm clicking any bar opens nothing — establishing that any later panel open is caused by this slice.
  - Post-change validation: For ten entries spanning four lanes, click each and assert the opened panel's id equals the entry id under the cursor; copy each resulting URL, reload in a fresh tab, and assert the restored window and open entry match.
- Acceptance: PRD criterion 3 met; a deep link opens the right entry at the right window
- Validation: manual — click an entry, copy the URL, reload in a new tab
- Commit: `feat(site): entry hit testing, detail panel, and hash routing`
- Size: M

### 2.4 Minimap + era jumps · `code`
- Files: `site/js/timeline.js`, `site/css/layout.css`
- [ ] Minimap showing the full range with the current window highlighted and draggable
- [ ] Header era-jump buttons: Hadean, Mesozoic, Ice Age, Bronze Age, Classical,
      Medieval, Modern
- **Test-first not meaningful here.** Pure navigation chrome over the already-tested `timescale` view API.
  - Pre-change proof: Record the current `[from, to]` from the hash before each jump.
  - Post-change validation: After each of the seven era buttons, assert the hash window equals that era's declared bounds; drag the minimap to three positions and assert the main view's `from` tracks `unitToYear` of the drag position within 1%.
- Acceptance: any era is reachable in one click from any zoom level
- Validation: manual browser check
- Commit: `feat(site): minimap navigation and era jump shortcuts`
- Size: S

**Phase 2 review point.** Confirm: no dropped entries, 60 fps pan at full range, deep links stable.

---

## Phase 3 — Curated dataset

### 3.0 Reading-link field · `code` · RED → GREEN
- Files: `pipeline/model.py`, `pipeline/loader.py`, `pipeline/emit.py`,
  `tests/test_model.py`, `tests/test_loader.py`, `tests/test_emit.py`, `README.md`
- [ ] RED: tests asserting `texts:` parses into `Source` records, defaults to `()`,
      rejects an entry missing `title` or `url` with the file/entry context, and lands in
      the era bundle alongside `sources` but under its own key
- [ ] Run `make test-py` — confirm RED, implement, confirm green
- [ ] Document the field and the sources-vs-texts distinction in `README.md`
- Acceptance: an entry can carry both a dating citation and a link to read the work
- Validation: `make test-py && make build`
- Commit: `feat(pipeline): texts field for links to the works themselves`
- Size: S
- Prerequisite for 3.2 and 3.4, which author the scripture entries that use it.


**Outcome:** ≥ 400 curated entries; every lane populated from 500 BCE on; every original
question answerable with sources.

Each slice below is one or more YAML files under `data/curated/`, validated by
`make validate` and committed separately. All are
`parallel_candidate: true` · `parallel_group: p3-content` ·
`parallel_write_scope: data/curated/<file>.yaml` ·
`parallel_ready_when: Phase 4 validation rules have landed`.

### 3.0b Taxonomy: a science lane and new categories · `code` · RED → GREEN
- Files: `data/taxonomy/regions.yaml`, `data/taxonomy/categories.yaml`,
  `site/css/tokens.css`, `tests/test_loader.py`, `tests/test_emit.py`
- [ ] RED: tests asserting the `science` lane loads with its own order and colour
      token, that an entry tagged `science` resolves to that lane rather than
      `global`, and that the new categories validate
- [ ] Split the current `global` lane ("Global / Science & Ideas") into two:
      `science` (Science & Discovery — people, discoveries, instruments, theories)
      and `global` (Global — things with no single home: ages, pandemics, trade)
- [ ] Add `--lane-science` to `tokens.css` in both themes
- [ ] Reassign existing seed entries: `origin-of-species`, `aryabhata`,
      `printing-press`, `moon-landing` move to `science`
- [ ] New categories: `disease`, `pandemic`, `independence`, `slavery`,
      `human-rights`, `discovery`, `instrument`
- Acceptance: scientists occupy their own row at every zoom level
- Validation: `make test-py && make build && make stats`
- Commit: `feat(data): dedicated science lane and categories for disease, independence, rights`
- Size: S
- Prerequisite for 3.4 and 3.6.

### 3.1 Deep time · `docs`
`deep-time.yaml` — Hadean through Holocene, mass extinctions, Cambrian explosion,
dinosaur era, K–Pg, Himalayan orogeny (India–Eurasia collision through ongoing uplift),
Pleistocene glaciations with named stadials, Toba, Last Glacial Maximum, Holocene onset.
Acceptance: ≥ 45 entries; each geological bound uses `Ma`/`Ga`/`ka` shorthand and cites
a source. Commit: `feat(data): deep time — geology, life, extinctions, glaciations`

### 3.2 India — prehistory to classical · `docs`
`india-ancient.yaml` — Mehrgarh, Indus Valley phases, Vedic period, Upanishads,
Mahajanapadas, Buddha, Mahavira, Maurya, Ashoka, Sangam era, Satavahana, Gupta,
Aryabhata, Kalidasa. Composition brackets for Rigveda, Brahmanas, Upanishads, Ramayana,
Mahabharata, Bhagavad Gita, and the Puranas — each `contested` where scholarship is
divided, with a `note` naming the competing positions and at least two sources.
Every scripture and epic entry also carries a `texts:` link to a full public-domain
translation on `archive.sacred-texts.com`.
Acceptance: ≥ 70 entries, and every `work` entry has at least one `texts:` link.
Commit: `feat(data): India — prehistory through the Gupta era`

### 3.3 India — medieval to modern · `docs`
`india-medieval.yaml`, `india-modern.yaml` — Chola, Rashtrakuta, Pala, Delhi Sultanate,
Vijayanagara, Bahmani, Mughal emperors individually, Maratha, Sikh Gurus, Bhakti and Sufi
figures (Kabir, Tulsidas, Surdas, Mirabai, Ravidas, Nanak, Chaitanya, Namdev, Tukaram,
Basava, Andal, Ramanuja, Madhvacharya, Adi Shankara), East India Company, 1857, colonial
period, independence, republic.
Acceptance: ≥ 130 entries across both files; every Bhakti figure carries a bracketed
lifespan with a confidence flag.
Commits: `feat(data): India — medieval dynasties and Bhakti era`,
`feat(data): India — colonial period through the republic`

### 3.4 World context · `docs`
`world-ancient.yaml`, `world-medieval.yaml`, `world-modern.yaml`, `science.yaml` —
non-India `work` entries (Tao Te Ching, Analects, Avesta, Quran, Kojiki, Popol Vuh,
Dhammapada, Torah, Gospels) likewise carry `texts:` links where a public-domain
translation exists —
Mesopotamia, Egypt, China (dynasty by dynasty), Persia, Greece, Rome, Maya, Andes,
Mali, Aksum, Islamic caliphates, Byzantium, medieval Europe, Mongols, Ottoman, Safavid,
Ming/Qing, Renaissance, Enlightenment, industrial and modern eras, plus a science and
technology thread (writing, the wheel, bronze, iron, printing, gunpowder, calculus,
evolution, relativity, computing, spaceflight, genomics).
Acceptance: ≥ 155 entries; for every century from 500 BCE to 2000 CE at least four
non-India lanes have an active entry.
Commits: one per file.

### 3.6 Science and discovery · `docs`
`science.yaml` — a dedicated lane of people and discoveries, so the thread of
what was *known* runs parallel to what was happening politically. Aryabhata,
Brahmagupta, Bhaskara II, Sushruta, Charaka, al-Khwarizmi, Ibn al-Haytham,
Shen Kuo, Archimedes, Hypatia, Copernicus, Galileo, Kepler, Newton, Lavoisier,
Darwin, Mendel, Curie, Ramanujan, Bose, Raman, Einstein, Noether, Fleming,
Franklin, Turing, Hopper, Sagan, plus the discoveries themselves (zero and the
decimal system, algebra, printing, the telescope, vaccination, germ theory,
electricity, evolution, relativity, antibiotics, DNA's structure, computing,
spaceflight, the genome).
Acceptance: ≥ 60 entries, the lane is populated in every century from 500 BCE on.
Commit: `feat(data): science and discovery lane`

### 3.7 Disease and pandemics · `docs`
`disease.yaml` — Plague of Athens, Antonine Plague, Plague of Justinian, the
Black Death, the Columbian exchange epidemics, recurring smallpox, the 1817
cholera pandemics, the 1918 influenza pandemic, HIV/AIDS, COVID-19, alongside
the countermeasures (variolation, Jenner's vaccine, germ theory, penicillin,
smallpox eradication).
Each carries an honest mortality range in `summary` where scholarship supports
one, and `confidence: contested` where it does not.
Acceptance: ≥ 20 entries; every pandemic entry cites a source.
Commit: `feat(data): epidemics, pandemics, and the medical response`

### 3.8 Independence, slavery, and rights · `docs`
`independence.yaml`, `africa.yaml` — independence dates for every country the
dataset touches, concentrated on the twentieth-century decolonisation waves
(1947 South Asia, 1956-1970 Africa, 1810-1825 Latin America), each as a point
event in its own region.
African history gets proper depth rather than a footnote: Nubia, Aksum, Ghana,
Mali, Songhai, Great Zimbabwe, Benin, Ethiopia; then the trans-Saharan and
transatlantic slave trades with their date ranges and scale, abolition dates by
country, the Scramble for Africa and the Berlin Conference, colonial rule,
independence, and apartheid in South Africa (1948-1994) through to the
democratic election.
Acceptance: ≥ 90 entries; Africa is populated in every century from 500 BCE on,
and no African century is represented solely by colonialism.
Commits: `feat(data): independence dates by country`,
`feat(data): African history, the slave trades, and apartheid`

### 3.9 The record gap: when the accounts were written · `docs`
`records.yaml` — for each major religious figure, a paired `work` entry for when
the surviving account of them was actually written down, `related` to the person
and carrying a `texts:` link. The distance between the two is often centuries,
and showing it side by side is something a timeline can do that prose cannot.

| Figure | Record | Approximate gap |
|---|---|---|
| Buddha | Pali Canon committed to writing | ~4 centuries |
| Mahavira | Jain Agamas fixed at the Valabhi council | ~9-10 centuries |
| Jesus | the canonical Gospels | ~35-80 years |
| Muhammad | the Uthmanic codification of the Quran | ~20 years |
| Guru Nanak | Adi Granth compiled, then the Guru Granth Sahib | ~65 / ~165 years |
| Kabir | Bijak and the Guru Granth Sahib collections | ~1-2 centuries |
| Confucius | the Analects | ~2-3 centuries |
| Zoroaster | the Avesta written down | contested, many centuries |
| Socrates | Plato's and Xenophon's accounts | ~1 generation |

Every entry in this file is `confidence: contested` or `medium`, carries a `note`
naming the competing positions, and cites at least two sources. Where a tradition
holds that the text is contemporaneous or eternal, the `note` says so plainly
rather than asserting the academic dating as settled fact.
Acceptance: ≥ 18 entries; every one has a `related` link to its figure, a
`texts:` link, a `note`, and ≥ 2 sources.
Commit: `feat(data): when the accounts of major figures were written down`

### 3.5 Coverage audit · `docs`
- [ ] Add `cli.stats` output: entries per lane per century, and a gap list
- [ ] Run `make stats`, fill every gap the audit names
- [ ] Verify PRD criteria 4 and 6 by hand in the browser
- Acceptance: no century from 500 BCE on has fewer than four populated lanes,
  and the `science` lane is populated in every century from 500 BCE on
- Validation: `make stats`
- Commit: `feat(data): close coverage gaps found by the audit`
- Size: M

**Phase 3 review point.** Spot-check 20 random entries against their cited sources.

---

## Phase 4 — Validation, year slice, search, filters

**Outcome:** the build refuses bad data; the year-slice and search views are complete.

### 4.1 Validation rules · `code` · RED → GREEN
- Files: `pipeline/validate.py`, `tests/test_validate.py`, `tests/fixtures/invalid/*.yaml`
- [ ] RED: one failing test per rule in the `spec.md` table (twelve), each asserting the
      message names the offending entry id
- [ ] Run `make test-py` — confirm RED, implement, confirm green
- [ ] Wire into `cli.build` so emit is unreachable when validation fails
- Acceptance: `make validate` passes on the real dataset; each bad fixture fails loudly
- Validation: `make test-py && make validate`
- Commit: `feat(pipeline): twelve validation rules gating the build`
- Size: M

### 4.2 Year slice · `code` · RED → GREEN
- Files: `site/js/slice.js`, `site/js/slice.test.js`, `site/js/yearview.js`,
  `site/js/router.js`, `site/css/panel.css`
- [ ] RED: `slice.test.js` — `activeIn` includes an interval containing the year,
      excludes one ending the year before, includes both edges, handles BCE spans across
      the year-zero boundary, marks boundary entries, ranks by importance
- [ ] Run `make test-js` — confirm RED, implement `slice.js`, confirm green
- [ ] `yearview.js`: grouped list, elapsed-position and age strings, ±1/±10 stepping,
      "view on timeline"; `#/year/<n>` route; double-click the axis to open it
- Acceptance: PRD criterion 4 met — `#/year/1555` shows the Mughal Empire, Akbar's
  accession, Tulsidas, and at least four other regions
- Validation: `make test-js` + manual check of `#/year/1555`
- Commit: `feat(site): year-slice cross-section view`
- Size: M

### 4.3 Search + filters · `code` · RED → GREEN
- Files: `site/js/search.js`, `site/js/search.test.js`, `site/js/main.js`,
  `site/css/layout.css`
- [ ] RED: prefix beats substring; alias matches ("Kabir Das" → `kabir`); diacritics and
      case folded; importance breaks ties; empty query returns nothing
- [ ] Run `make test-js` — confirm RED, implement, confirm green
- [ ] Search box with `/` shortcut; selecting a result zooms to that entry's span
- [ ] Lane and kind filter menu, reflected in the hash
- Acceptance: PRD criterion 5 met
- Validation: `make test-js` + manual — type `Kabir`, press Enter
- Commit: `feat(site): search with alias matching and lane/kind filters`
- Size: M

**Phase 4 review point.** Confirm every PRD criterion except 7–9 is demonstrable.

---

## Phase 5 — Wikidata import

**Outcome:** thousands of additional entries, curated data untouched.

### 5.1 SPARQL client · `code` · RED → GREEN
- Files: `pipeline/wikidata.py`, `tests/test_wikidata.py`,
  `tests/fixtures/wikidata_response.json`
- [ ] RED: tests asserting the recorded response normalizes to `Entry` objects with
      `origin="wikidata"`, that `P569`/`P570` become start//end bounds, that Wikidata
      precision 9 (year) and 8 (decade) widen the bracket correctly, and that entries
      with no usable date are skipped
- [ ] Run `make test-py` — confirm RED, implement, confirm green
- [ ] Topic queries as named constants: indian-rulers, indian-writers, world-rulers,
      battles, scientists, religious-figures, dynasties, structures
- [ ] Descriptive User-Agent, `LIMIT`/`OFFSET` paging, 1 s inter-query sleep, on-disk
      cache under `data/imported/.cache/`
- Acceptance: `python -m pipeline.cli import --topic indian-writers` writes a committed
  JSON file; no network call happens during `make build`
- Validation: `make test-py` then one live import run
- Commit: `feat(pipeline): Wikidata SPARQL importer with caching`
- Size: M

### 5.2 Merge and dedupe · `code` · RED → GREEN
- Files: `pipeline/merge.py`, `tests/test_merge.py`
- [ ] RED: curated wins on matching Qid; curated wins on normalized title with
      overlapping brackets; non-overlapping same-title entries are both kept; the
      collision report names every dropped id
- [ ] Run `make test-py` — confirm RED, implement, confirm green
- [ ] Wire into `cli.build` ahead of validation
- Acceptance: no curated entry is ever replaced; the build summary lists collisions
- Validation: `make test-py && make build && make stats`
- Commit: `feat(pipeline): curated-wins merge with collision reporting`
- Size: M

### 5.3 Run the imports · `docs`
- [ ] Run all eight topics, review the diffs for obvious junk, tune the importance filter
- [ ] Rebuild and confirm the timeline stays responsive at the new entry count
- Acceptance: total entries ≥ 3000 with curated entries intact and rendering unchanged
- Validation: `make build && make stats` + manual browser check
- Commit: `feat(data): import eight Wikidata topics`
- Size: S

**Phase 5 review point.** Confirm curated entries survived byte-identical.

---

## Phase 6 — Accessibility, performance, deploy

**Outcome:** shippable — accessible, fast at scale, live on GitHub Pages.

### 6.1 Accessibility · `code`
- Files: `site/js/a11y.js`, `site/js/{panel,timeline,main}.js`, `site/css/*.css`
- [ ] Hidden focusable mirror list of visible entries, capped at 300 with an announced count
- [ ] Focus-trapped `role="dialog"` panel; focus returns to the invoking element
- [ ] Polite live region announcing window changes and result counts
- [ ] Full keyboard map from `design.md`; visible focus rings
- [ ] `prefers-reduced-motion` disables easing and slide transitions
- [ ] Contrast audit of both themes; lane identity never carried by color alone
- **Test-first not meaningful here.** Screen-reader and focus behavior are only meaningfully verified against a real assistive-technology stack, which cannot be asserted from a unit test.
  - Pre-change proof: Keyboard-only pass over the pre-change build, recording every point where focus is lost or an action is unreachable.
  - Post-change validation: Repeat the same pass and confirm every recorded point is resolved; VoiceOver pass confirming the mirror list announces entry count and each entry's title and date; verify focus returns to the invoking element after panel close for five different invocation paths.
- Acceptance: the site is fully operable with the keyboard alone; PRD criterion 9 met
- Validation: manual keyboard pass + macOS VoiceOver pass
- Commit: `feat(site): keyboard navigation, screen-reader mirror, and reduced motion`
- Size: M

### 6.2 Performance pass · `code`
- Files: `site/js/{timeline,store,layout}.js`, `pipeline/emit.py`
- [ ] Redraw only on change; coalesce wheel events into one `requestAnimationFrame`
- [ ] Per-lane sorted interval index built once, reused across frames
- [ ] Measure `spine.json` gzipped; if over 600 KB, shard it by lane and load on demand
- [ ] Confirm pan and zoom stay smooth at the full entry count
- **Test-first not meaningful here.** Performance is measured, not asserted — a timing assertion in CI would be flaky on shared runners.
  - Pre-change proof: Record a devtools performance trace panning the full range at the current entry count, plus `gzip -c site/data/spine.json | wc -c`. These are the numbers to beat.
  - Post-change validation: Repeat both measurements; require the frame budget to hold at 16.7 ms p95 and the gzipped spine to be under 600 KB. Record both numbers in the commit message so regressions are visible in history.
- Acceptance: first paint under 600 KB gzipped; no dropped frames while panning at full range
- Validation: browser devtools network + performance panels
- Commit: `perf(site): incremental redraw, interval index, and payload budget`
- Size: M

### 6.3 Responsive + mobile · `code`
- Files: `site/css/{layout,panel,timeline}.css`, `site/js/timeline.js`
- [ ] 390 px layout: panel becomes a bottom sheet, lane headers collapse to icons
- [ ] Pinch-zoom and touch pan via pointer events
- [ ] No horizontal page scroll at any width
- **Test-first not meaningful here.** Layout at a viewport size is visual output.
  - Pre-change proof: Screenshots at 390 px, 768 px and 1440 px before the change, noting horizontal overflow and any clipped control.
  - Post-change validation: Same three widths after; assert `document.documentElement.scrollWidth === clientWidth` at each, and confirm a pinch gesture changes the view window while a single-finger drag pans it.
- Acceptance: usable on a phone-width viewport
- Validation: manual check at 390 px, 768 px, 1440 px
- Commit: `feat(site): responsive layout and touch gestures`
- Size: S

### 6.4 CI and Pages · `infra`
- Files: `.github/workflows/{ci,pages}.yml`, `README.md`
- [ ] `ci.yml`: on push and PR — `make test` and `make validate`
- [ ] `pages.yml`: on push to `main` — publish `site/` via `actions/deploy-pages`
- [ ] README: live URL, local preview, how to add an entry, how to run an import
- [ ] Push and confirm the deployed site loads and every PRD criterion holds live
- Acceptance: PRD criteria 7 and 8 met; the site is live
- Validation: green CI run + the deployed URL opens and renders
- Commit: `ci: test and validate on push, publish site/ to GitHub Pages`
- Size: S

**Phase 6 review point.** Walk all nine PRD acceptance criteria against the live site.

---

## Blockers that send work back to planning

- The piecewise-log scale proves unreadable in practice at some zoom band — rescoping the
  time model is a planning decision, not a build-time patch.
- `spine.json` exceeds the 600 KB budget even after lane sharding — the spine/detail split
  itself needs redesign.
- Wikidata import quality is bad enough that curated-wins merge cannot rescue it — drop
  the import and re-plan dataset growth as curation-only.
- A contested Indian chronology entry cannot be written neutrally within the `note` +
  `sources` contract — escalate rather than pick a side in code.
