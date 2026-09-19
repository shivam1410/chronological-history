import { loadEra, loadIndex } from './store.js';
import { createTimeline } from './timeline.js';
import { createPanel } from './panel.js';
import { createRouter } from './router.js';
import { createMinimap } from './minimap.js';
import { ERAS } from './eras.js';
import { formatYear, roundYear } from './format.js';
import { ORIGIN_YEAR, presentYear } from './timescale.js';

const stage = document.querySelector('#stage');
const metaLabel = document.querySelector('#meta');
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
      syncHash();
    },
    onNavigate: (id) => selectEntry(byId.get(id) ?? null, { focus: true }),
  });

  // The minimap and era buttons are built before the timeline because
  // createTimeline fires onViewChange during construction, and that callback
  // reaches for both. Their own callbacks only run on user input, long after
  // the timeline binding exists, so referencing it lazily is safe.
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
      const overlap = Math.min(view.to, era.to) - Math.max(view.from, era.from);
      const fraction = overlap / (view.to - view.from);
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
      metaLabel.textContent = `${entries.length} entries · ${describe(view)}`;
      minimap.setWindow(view.from, view.to);
      markCurrentEra(view);
      syncHash(true);
    },
    onSelect: (entry) => selectEntry(entry),
  });

  function selectEntry(entry, { focus = false } = {}) {
    if (!entry) {
      panel.close();
      timeline.select(null);
      return;
    }
    timeline.select(entry.id);
    if (focus) {
      // Arriving from a related-entry chip: bring the entry into view.
      const pad = Math.max(1, (entry.eMax - entry.sMin) * 0.6);
      timeline.setView(entry.sMin - pad, entry.eMax + pad);
    }
    panel.open(entry, async () => {
      const bundle = await loadEra(entry.bucket);
      return bundle.entries[entry.id] ?? {};
    }, { returnFocusTo: canvas });
    live.textContent = `${entry.title}. ${describe(timeline.view)}.`;
    syncHash();
  }

  function applyState(state) {
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
    timeline, panel, router, minimap, entries, info, selectEntry, ERAS,
  };
  applyState(router.current());
  minimap.setWindow(timeline.view.from, timeline.view.to);
  markCurrentEra(timeline.view);
  metaLabel.textContent = `${entries.length} entries · ${describe(timeline.view)}`;
}

start();
