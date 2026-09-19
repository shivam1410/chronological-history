/**
 * Top-bar controls: indexed search and the date-range filter.
 *
 * Both are thin views over state that lives elsewhere - the search index in
 * search.js, the window in the timeline's view - so this module owns DOM and
 * keyboard handling and nothing else.
 */

import { buildIndex, search } from './search.js';
import { formatYear, roundYear } from './format.js';

const MAX_RESULTS = 8;

function parseYearInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  // Accept "500 BCE", "500 bc", "-500", "1526", "1526 CE".
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
