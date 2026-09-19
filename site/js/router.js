/**
 * The URL hash is the single source of truth for what is on screen.
 *
 * Every view is therefore linkable and the browser's own back and forward
 * buttons work without any extra history handling.
 *
 *   #/timeline?from=-4540000000&to=2026
 *   #/entry/mughal-empire?from=1400&to=1900
 */

import { roundYear } from './format.js';

const DEFAULT_STATE = { route: 'timeline', from: null, to: null, entryId: null };

function parseYear(raw) {
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

/** Parse a location hash into view state. Never throws on malformed input. */
export function parseHash(hash) {
  const text = String(hash ?? '').replace(/^#/, '');
  if (!text || text === '/') return { ...DEFAULT_STATE };

  const [path, query = ''] = text.split('?');
  const params = new URLSearchParams(query);
  const from = parseYear(params.get('from'));
  const to = parseYear(params.get('to'));

  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'entry' && segments[1]) {
    return { route: 'entry', from, to, entryId: decodeURIComponent(segments[1]) };
  }
  // Anything unrecognised is still a timeline; a bad link should not dead-end.
  return { route: 'timeline', from, to, entryId: null };
}

/** Build a hash from view state. Rounds years and never emits year zero. */
export function buildHash({ from = null, to = null, entryId = null } = {}) {
  const params = new URLSearchParams();
  if (from !== null && Number.isFinite(from)) params.set('from', String(roundYear(from)));
  if (to !== null && Number.isFinite(to)) params.set('to', String(roundYear(to)));
  const query = params.toString();

  const path = entryId ? `/entry/${encodeURIComponent(entryId)}` : '/timeline';
  return query ? `#${path}?${query}` : `#${path}`;
}

/**
 * Wire hash changes to a callback and back again.
 *
 * `navigate` skips the write when the hash already matches, so a change that
 * originated from the URL does not echo back as a second history entry.
 */
export function createRouter({ onChange } = {}) {
  let last = null;

  const read = () => parseHash(window.location.hash);

  window.addEventListener('hashchange', () => {
    const state = read();
    last = window.location.hash;
    onChange?.(state);
  });

  return {
    current: read,
    navigate(state, { replace = false } = {}) {
      const hash = buildHash(state);
      if (hash === window.location.hash || hash === last) return;
      last = hash;
      if (replace) {
        window.history.replaceState(null, '', hash);
      } else {
        window.location.hash = hash;
      }
    },
  };
}
