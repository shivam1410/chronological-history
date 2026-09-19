/**
 * Top-bar controls: indexed search and the date-range filter.
 *
 * Both are thin views over state that lives elsewhere - the search index in
 * search.js, the window in the timeline's view - so this module owns DOM and
 * keyboard handling and nothing else.
 */

import { buildIndex, search } from './search.js';
import { BP_EPOCH, formatYear, fromAstroYear, roundYear } from './format.js';

const MAX_RESULTS = 8;

/**
 * Suggested boundaries for the range fields, offered as a native datalist.
 *
 * A dropdown rather than a plain text box because most of these are values
 * nobody would think to type - "2.58 Ma" is the start of the Pleistocene, and
 * you only know that if you already knew it.
 */
const YEAR_ANCHORS = [
  ['4.54 Ga', 'Earth forms'],
  ['541 Ma', 'Cambrian explosion'],
  ['252 Ma', 'Permian extinction'],
  ['66 Ma', 'End of the dinosaurs'],
  ['2.58 Ma', 'Pleistocene begins'],
  ['12 ka', 'Agriculture begins'],
  ['3000 BCE', 'Writing, Bronze Age'],
  ['1000 BCE', 'Iron Age'],
  ['500 BCE', 'Buddha, classical Greece'],
  ['1 CE', 'Common Era begins'],
  ['500 CE', 'Fall of Rome'],
  ['1000', 'High Middle Ages'],
  ['1500', 'Renaissance, Mughals'],
  ['1700', 'Enlightenment'],
  ['1800', 'Industrial era'],
  ['1900', 'Twentieth century'],
  ['2000', 'Present day'],
];

const DEEP_UNITS = { ka: 1e3, Ma: 1e6, Ga: 1e9 };
const DEEP_RE = /^(\d+(?:\.\d+)?)\s*(ka|Ma|Ga)$/;

/**
 * Parse what the range fields accept, which must include everything they can
 * display: "4.54 Ga", "66 Ma", "12 ka", "500 BCE", "-500", "1526", "1526 CE".
 *
 * The deep-time suffixes matter because the fields are filled from formatYear,
 * so without them the round trip turns "4.54 Ga" into the year 4.
 */
function parseYearInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const deep = DEEP_RE.exec(text);
  if (deep) {
    const bp = Math.round(Number(deep[1]) * DEEP_UNITS[deep[2]]);
    return fromAstroYear(BP_EPOCH - bp);
  }

  // Anchored at the end rather than on a word boundary: there is no boundary
  // between a digit and a letter, so "500BCE" would not match \bBCE.
  const era = /b\.?c\.?e?\.?$/i.test(text) ? -1 : 1;
  const digits = text.replace(/[^\d.-]/g, '');
  if (!digits || digits === '-') return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;

  const year = era === -1 ? -Math.abs(value) : value;
  return year === 0 ? 1 : Math.trunc(year);
}

export function createControls({
  searchInput, resultsList, fromInput, toInput, rangeForm,
  entries, onPick, onRange,
}) {
  const index = buildIndex(entries);

  // A shared datalist turns both range fields into combo boxes: the suggestions
  // drop down, and anything else can still be typed.
  const anchors = document.createElement('datalist');
  anchors.id = 'year-anchors';
  for (const [value, label] of YEAR_ANCHORS) {
    const option = document.createElement('option');
    option.value = value;
    option.label = label;
    anchors.append(option);
  }
  rangeForm.append(anchors);
  fromInput.setAttribute('list', anchors.id);
  toInput.setAttribute('list', anchors.id);
  let results = [];
  let active = -1;

  // ---- search ------------------------------------------------------------

  function closeResults() {
    results = [];
    active = -1;
    resultsList.replaceChildren();
    resultsList.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
  }

  function renderResults() {
    resultsList.replaceChildren();
    results.forEach((hit, i) => {
      const item = document.createElement('li');
      item.className = 'results__item';
      item.id = `result-${i}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(i === active));
      if (i === active) item.dataset.active = 'true';

      const name = document.createElement('span');
      name.className = 'results__name';
      name.textContent = hit.entry.title;

      const when = document.createElement('span');
      when.className = 'results__when';
      when.textContent = hit.entry.sMin === hit.entry.eMax
        ? formatYear(hit.entry.sMin)
        : `${formatYear(hit.entry.sMin)}–${formatYear(hit.entry.eMax)}`;

      item.append(name, when);
      item.addEventListener('mousedown', (event) => {
        // mousedown, not click: blur would close the list first.
        event.preventDefault();
        pick(i);
      });
      resultsList.append(item);
    });
    resultsList.hidden = results.length === 0;
    searchInput.setAttribute('aria-expanded', String(results.length > 0));
    searchInput.setAttribute('aria-activedescendant',
      active >= 0 ? `result-${active}` : '');
  }

  function pick(i) {
    const hit = results[i];
    if (!hit) return;
    searchInput.value = hit.entry.title;
    closeResults();
    searchInput.blur();
    onPick?.(hit.entry);
  }

  searchInput.addEventListener('input', () => {
    results = search(index, searchInput.value, { limit: MAX_RESULTS });
    active = results.length ? 0 : -1;
    renderResults();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeResults();
      searchInput.value = '';
      searchInput.blur();
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = (active + 1) % results.length;
      renderResults();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active - 1 + results.length) % results.length;
      renderResults();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(active >= 0 ? active : 0);
    }
  });

  searchInput.addEventListener('blur', () => setTimeout(closeResults, 120));

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== searchInput) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  // ---- date range --------------------------------------------------------

  for (const input of [fromInput, toInput]) {
    input.addEventListener('focus', () => input.select());
  }

  rangeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const from = parseYearInput(fromInput.value);
    const to = parseYearInput(toInput.value);
    if (from === null || to === null || from === to) return;
    onRange?.(Math.min(from, to), Math.max(from, to));
    fromInput.blur();
    toInput.blur();
  });

  return {
    /** Reflect the current window, unless the reader is mid-edit. */
    setRange(from, to) {
      const editing = document.activeElement === fromInput
        || document.activeElement === toInput;
      if (editing) return;
      fromInput.value = formatYear(roundYear(from));
      toInput.value = formatYear(roundYear(to));
    },
    closeResults,
  };
}

export { parseYearInput };
