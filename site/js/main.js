import { loadEra, loadIndex } from './store.js';
import { createTimeline } from './timeline.js';
import { createPanel } from './panel.js';
import { createRouter } from './router.js';
import { createMinimap } from './minimap.js';
import { ERAS } from './eras.js';
import { createControls } from './controls.js';
import { createYearView } from './yearview.js';
import { elapsed, formatYear, roundYear } from './format.js';
import { ORIGIN_YEAR, presentYear } from './timescale.js';

const stage = document.querySelector('#stage');
const live = document.querySelector('#live');
const eraNav = document.querySelector('#eras');
const minimapCanvas = document.querySelector('#minimap');

function showError(error) {
  stage.replaceChildren();
  const box = document.createElement('div');
  box.className = 'error';
  box.innerHTML = `
    <h2>Could not load the timeline data</h2>
    <p>The site needs to be served over http. Opening index.html directly
       from the filesystem will not work.</p>
    <p><code></code></p>
    <button type="button">Retry</button>`;
  box.querySelector('code').textContent = error.url
    ? `${error.message} — ${error.cause?.message ?? ''}`
    : String(error);
  box.querySelector('button').addEventListener('click', () => start());
  stage.append(box);
}

const describe = (view) =>
  `${formatYear(roundYear(view.from))} to ${formatYear(roundYear(view.to))}`;

async function start() {
  stage.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  canvas.className = 'timeline';
  canvas.tabIndex = 0;
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'scroll to zoom · drag to pan · click an entry';
  stage.append(canvas, hint);

  let info;
  let entries;
  try {
    ({ meta: info, entries } = await loadIndex());
  } catch (error) {
    showError(error);
    return;
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  // The hash is the source of truth; writes are debounced so a drag does not
  // push one history entry per animation frame.
  let router;
  let writeTimer = null;
  const syncHash = (replace = false) => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      router.navigate(
        { from: timeline.view.from, to: timeline.view.to, entryId: panel.openId },
        { replace },
      );
    }, 180);
  };

  const panel = createPanel(stage, {
    onClose: () => {
      timeline.select(null);
      if (yearView.year === null) syncHash();
    },
    onNavigate: (id) => selectEntry(byId.get(id) ?? null, {
      focus: yearView.year === null,
      keepYearView: yearView.year !== null,
    }),
  });

  // The minimap and era buttons are built before the timeline because
  // createTimeline fires onViewChange during construction, and that callback
  // reaches for both. Their own callbacks only run on user input, long after
  // the timeline binding exists, so referencing it lazily is safe.
  // Built before the timeline for the same reason as the minimap: the
  // callbacks below only fire on user input, long after these bindings exist.
  const yearView = createYearView(stage, {
    entries,
    lanes: info.lanes,
    onStep: (year) => router.navigate({ year }),
    onClose: () => router.navigate({
      from: timeline.view.from, to: timeline.view.to,
    }),
    // Centre the timeline on the year being viewed, with enough either side
    // to see what it sat between.
    onViewOnTimeline: (year) => {
      const half = 75;
      const from = year - half === 0 ? -1 : year - half;
      const to = year + half === 0 ? 1 : year + half;
      router.navigate({ from, to });
    },
    // Opens the detail panel over the year list rather than leaving it. The
    // header's "View on timeline" is the explicit way out; losing a year's
    // worth of context to read one entry is not a reasonable price for a click.
    onPick: (entry) => selectEntry(entry, { keepYearView: true }),
  });

  // Same ordering reason as the minimap: onViewChange fires during
  // createTimeline and reaches for `controls`.
  const controls = createControls({
    searchInput: document.querySelector('#search'),
    resultsList: document.querySelector('#results'),
    fromInput: document.querySelector('#from'),
    toInput: document.querySelector('#to'),
    rangeForm: document.querySelector('#range'),
    entries,
    onPick: (entry) => selectEntry(entry, { focus: true }),
    onRange: (from, to) => {
      // Both fields the same year is a request for that single year.
      if (from === to) router.navigate({ year: from });
      else timeline.setView(from, to);
    },
  });

  const minimap = createMinimap(minimapCanvas, {
    entries,
    lanes: info.lanes,
    onWindow: (from, to) => timeline.setView(from, to),
  });

  const eraButtons = ERAS.map((era) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = era.label;
    button.dataset.era = era.id;
    button.addEventListener('click', () => timeline.setView(era.from, era.to));
    return button;
  });
  eraNav.replaceChildren(...eraButtons);

  /** Highlight the era the window mostly sits inside, for orientation. */
  function markCurrentEra(view) {
    let best = null;
    let bestFraction = 0;
    for (const era of ERAS) {
      const overlap = elapsed(Math.max(view.from, era.from), Math.min(view.to, era.to));
      const fraction = overlap / view.span;
      if (overlap > 0 && fraction > bestFraction) {
        bestFraction = fraction;
        best = era.id;
      }
    }
    for (const button of eraButtons) {
      const current = best && button.dataset.era === best && bestFraction > 0.5;
      if (current) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  const timeline = createTimeline(canvas, {
    entries,
    lanes: info.lanes,
    onViewChange: (view) => {
      minimap.setWindow(view.from, view.to);
      controls.setRange(view.from, view.to);
      markCurrentEra(view);
      syncHash(true);
    },
    onSelect: (entry) => selectEntry(entry),
    onPickYear: (year) => router.navigate({ year: roundYear(year) }),
  });

  function selectEntry(entry, { focus = false, keepYearView = false } = {}) {
    if (!entry) {
      panel.close();
      timeline.select(null);
      return;
    }
    timeline.select(entry.id);
    if (focus) {
      // Arriving from a related-entry chip: bring the entry into view.
      const pad = Math.max(1, elapsed(entry.sMin, entry.eMax) * 0.6);
      timeline.setView(entry.sMin - pad, entry.eMax + pad);
    }
    panel.open(entry, async () => {
      const bundle = await loadEra(entry.bucket);
      return bundle.entries[entry.id] ?? {};
    }, { returnFocusTo: canvas });
    live.textContent = `${entry.title}. ${describe(timeline.view)}.`;

    // The year stays the address while its list is open, so the panel is a
    // detail on top of it rather than a new place.
    if (!keepYearView) syncHash();
  }

  function applyState(state) {
    if (state.route === 'year' && state.year !== null) {
      panel.close();
      timeline.select(null);
      yearView.show(state.year);
      live.textContent = `Year view for ${state.year}.`;
      return;
    }
    if (yearView.year !== null) yearView.close();

    const from = state.from ?? ORIGIN_YEAR;
    const to = state.to ?? presentYear();
    if (from !== timeline.view.from || to !== timeline.view.to) timeline.setView(from, to);

    const entry = state.entryId ? byId.get(state.entryId) : null;
    if (entry && panel.openId !== entry.id) selectEntry(entry);
    else if (!entry && panel.openId) { panel.close(); timeline.select(null); }
  }

  router = createRouter({ onChange: applyState });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.openId) canvas.focus();
  });

  window.__timeline = {
    timeline, panel, router, minimap, controls, yearView,
    entries, info, selectEntry, ERAS,
  };
  applyState(router.current());
  minimap.setWindow(timeline.view.from, timeline.view.to);
  controls.setRange(timeline.view.from, timeline.view.to);
  markCurrentEra(timeline.view);
}

start();
