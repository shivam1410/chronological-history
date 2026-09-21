import { loadEra, loadIndex } from './store.js';
import { createTimeline } from './timeline.js';
import { createPanel } from './panel.js';
import { createRouter } from './router.js';
import { createMinimap } from './minimap.js';
import { ERAS } from './eras.js';
import { createControls } from './controls.js';
import { createYearView } from './yearview.js';
import { elapsed, formatYear, roundYear } from './format.js';
import { sameLane, elsewhere } from './context.js';
import { ORIGIN_YEAR, presentYear } from './timescale.js';
import { DEFAULT_TITLE, readEnvironment, siteTitle } from './title.js';

/*
 * The site answers to a different name in India.
 *
 * Both the tab and the heading, not just the heading - the heading is hidden
 * below 1280px, where most readers are, so changing it alone would rename the
 * site for almost nobody. The tab is the one place the name always shows.
 *
 * Done before the data loads, so the name never visibly changes under the
 * reader, and left alone when it matches the markup so the hand-placed
 * non-breaking space in the default survives.
 */
function nameThisSite() {
  const title = siteTitle(readEnvironment());
  document.title = title;
  if (title === DEFAULT_TITLE) return;
  const heading = document.querySelector('.header__title');
  if (heading) heading.textContent = title;
}

nameThisSite();

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
  hint.textContent = 'scroll to zoom · drag to pan · click an entry · click the axis for one year';
  stage.append(canvas, hint);

  // The hint sits over the bottom-right of the chart, so it retires once it has
  // been read - on the first real interaction, or after long enough that the
  // reader is not going to have one. It has said its piece by then.
  const retireHint = () => {
    hint.dataset.retired = 'true';
    clearTimeout(hintTimer);
    for (const event of ['pointerdown', 'wheel', 'keydown']) {
      canvas.removeEventListener(event, retireHint);
    }
  };
  const hintTimer = setTimeout(retireHint, 12_000);
  for (const event of ['pointerdown', 'wheel', 'keydown']) {
    canvas.addEventListener(event, retireHint, { passive: true });
  }

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
      // A year is its own address. The timeline keeps a window underneath the
      // year view and fires onViewChange while it is open - including once
      // during its own construction - so without this a deep link to a year
      // rewrites itself to the timeline route within 180ms, and reloading or
      // sharing the link loses the year.
      if (yearView.year !== null) return;
      router.navigate(
        { from: timeline.view.from, to: timeline.view.to, entryId: panel.openId },
        { replace },
      );
    }, 180);
  };

  const SAME_TIME_MAX = 6;

  /**
   * The rest of the world while this entry ran. Its own lane is excluded:
   * that is what the strip above this list draws, and showing an entry in
   * both places would waste the card's most valuable space on a repeat.
   */
  const contemporaries = (entry) => elsewhere(entries, entry, { limit: SAME_TIME_MAX })
    .map((other) => ({
      id: other.id,
      title: other.title,
      laneLabel: info.lanes.find((l) => l.id === other.lane)?.label ?? other.lane,
      when: other.sMin === other.eMax
        ? formatYear(other.sMin)
        : `${formatYear(other.sMin)} \u2013 ${formatYear(other.eMax)}`,
    }));

  const panel = createPanel(stage, {
    contemporaries,
    laneNeighbours: (entry) => sameLane(entries, entry),
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
    rangeSummary: document.querySelector('#range-summary'),
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
  // Dividers are real elements, not pseudo-elements on the buttons: with the
  // row justified the gaps are whatever is left over, and a pseudo-element at
  // a fixed offset drifts off-centre as that changes. As flex items they are
  // placed by the same justification as the labels.
  const eraChildren = [];
  eraButtons.forEach((button, i) => {
    if (i > 0) {
      const rule = document.createElement('span');
      rule.className = 'eras__rule';
      rule.setAttribute('aria-hidden', 'true');
      eraChildren.push(rule);
    }
    eraChildren.push(button);
  });
  eraNav.replaceChildren(...eraChildren);

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
      const detail = bundle.entries[entry.id] ?? {};
      // Curated links can point outside the entry's own span - Valmiki to
      // Kalidasa, eight centuries apart - so they are lit only once the detail
      // that names them has arrived.
      if (panel.openId === entry.id) timeline.select(entry.id, detail.related ?? []);
      return detail;
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
    // Silent: this state change already says where to go, and onClose would
    // navigate back to the window the timeline happened to be showing -
    // which is what made "View on timeline" land on the old view instead of
    // the year it named.
    if (yearView.year !== null) yearView.close({ silent: true });

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
