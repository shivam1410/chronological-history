/**
 * "What was happening in year X?" - the list answer to the question the
 * timeline answers visually. Pure: no DOM, no fetch.
 *
 * Every query runs against the spine, which holds each entry's full interval,
 * so asking for a year costs a scan of memory rather than a round trip.
 */

import { astro, duration, formatAge, formatDuration } from './format.js';

/**
 * Entries whose span contains `year`, ranked for reading.
 *
 * Returns `{ entry, boundary }`. Anything that begins or ends in the queried
 * year is marked and sorted first, because a year in which something started
 * is more interesting than a century merely passing through it.
 */
export function activeIn(entries, year) {
  const target = astro(year); // throws on year zero, which is the point

  return entries
    .filter((entry) => astro(entry.sMin) <= target && target <= astro(entry.eMax))
    .map((entry) => ({
      entry,
      boundary: entry.sMin === year || entry.eMax === year,
    }))
    .sort((a, b) =>
      Number(b.boundary) - Number(a.boundary)
      || b.entry.imp - a.entry.imp
      || astro(a.entry.sMin) - astro(b.entry.sMin)
      || (a.entry.id < b.entry.id ? -1 : 1));
}

/**
 * Group hits into lanes, in the given order, dropping empty ones.
 *
 * A lane missing from `laneOrder` is appended rather than discarded - an
 * untaxonomied lane is a data bug, and silently dropping its entries hides it.
 */
export function groupByLane(hits, laneOrder) {
  const groups = new Map(laneOrder.map((lane) => [lane, []]));
  for (const hit of hits) {
    if (!groups.has(hit.entry.lane)) groups.set(hit.entry.lane, []);
    groups.get(hit.entry.lane).push(hit);
  }
  return [...groups]
    .filter(([, hits_]) => hits_.length > 0)
    .map(([lane, hits_]) => ({ lane, hits: hits_ }));
}

/**
 * Where `year` falls within an entry's span, in words.
 *
 * A bar shows that the Mughals existed in 1555. This says it was year 29 of
 * 331 - an empire in its youth rather than its decline - which is the part a
 * timeline cannot draw.
 */
/** Beyond this, counting individual years stops meaning anything. */
const DEEP_SPAN = 10_000;

export function positionIn(entry, year) {
  if (entry.sMin === entry.eMax) return 'this year';
  if (entry.sMin === year) return 'begins';
  if (entry.eMax === year) return 'ends';

  const elapsed = duration(entry.sMin, year);
  const total = duration(entry.sMin, entry.eMax);

  // "year 58999605 of 59000076" is true and useless.
  if (total > DEEP_SPAN) return `${formatDuration(elapsed)} in`;

  if (entry.kind === 'person') {
    // A bracketed birth means a range of possible ages. Reporting the oldest
    // as though it were known would invent precision the dataset does not have.
    const oldest = duration(entry.sMin, year);
    const youngest = duration(entry.sMax, year);

    // The queried year can fall inside a bracketed birth, in which case the
    // person may not have been born yet and the lower bound goes negative.
    // "age -20-63" is not an age; "age up to 63" is what is actually known.
    if (youngest < 0) return `age up to ${oldest}`;
    if (oldest !== youngest) {
      return `age ${Math.min(youngest, oldest)}\u2013${Math.max(youngest, oldest)}`;
    }
    return formatAge(entry.sMin, year);
  }

  return `year ${elapsed} of ${total}`;
}

/**
 * Entries whose span overlaps this one's - what else was going on.
 *
 * Overlap, not proximity: a century-long dynasty and a single year inside it
 * were both happening at once, and a reader asking "what else?" means exactly
 * that. Sorted so the answer leads with what matters and what started nearest,
 * because the full list for a long-running entry is most of the dataset.
 */
export function overlapping(entries, entry, { limit = Infinity } = {}) {
  if (!entry) return [];
  const from = astro(entry.sMin);
  const to = astro(entry.eMax);

  return entries
    .filter((other) => other.id !== entry.id
      && astro(other.sMin) <= to && astro(other.eMax) >= from)
    .sort((a, b) => b.imp - a.imp
      || Math.abs(astro(a.sMin) - from) - Math.abs(astro(b.sMin) - from)
      || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}
