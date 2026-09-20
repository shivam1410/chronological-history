/**
 * The card's own slice of the timeline: what a lane looked like around one
 * entry. Pure - no DOM, no fetch.
 *
 * This answers a different question from "At the same time". That list looks
 * outward, at the rest of the world; this looks along the entry's own lane, at
 * what came before it, beside it and after it. An empire wants both: who else
 * held this ground, and what was happening elsewhere while it did.
 */

import { astro, fromAstroYear } from './format.js';
import { niceStep } from './timescale.js';
import { overlapping } from './slice.js';

/** Overlapping entries in the same lane - the succession around this one. */
export function sameLane(entries, entry, { limit = 8 } = {}) {
  if (!entry) return [];
  return overlapping(entries, entry)
    .filter((other) => other.lane === entry.lane)
    .slice(0, limit);
}

/** Overlapping entries anywhere else - the rest of the world, meanwhile. */
export function elsewhere(entries, entry, { limit = 6 } = {}) {
  if (!entry) return [];
  return overlapping(entries, entry)
    .filter((other) => other.lane !== entry.lane)
    .slice(0, limit);
}

/**
 * The years to show around an entry.
 *
 * Sized from the entry alone, not from its neighbours: a single long-running
 * neighbour - a dynasty lasting five centuries - would otherwise zoom the
 * strip out until the entry itself was a sliver. Neighbours simply clip at the
 * edges, which is also how the reader learns they run past them.
 */
export function windowFor(entry, { pad = 0.45 } = {}) {
  const lo = astro(entry.sMin);
  const hi = astro(entry.eMax);
  const margin = Math.max(1, Math.round(Math.max(1, hi - lo) * pad));
  return { from: fromAstroYear(lo - margin), to: fromAstroYear(hi + margin) };
}

/** Shift a window by a fraction of its own width, for Earlier / Later. */
export function panWindow({ from, to }, fraction) {
  const lo = astro(from);
  const hi = astro(to);
  // The floor is on the magnitude, not the signed value: clamping the signed
  // shift turned a backward pan of 250 years into a forward pan of one.
  const magnitude = Math.max(1, Math.round((hi - lo) * Math.abs(fraction)));
  const by = fraction < 0 ? -magnitude : magnitude;
  return { from: fromAstroYear(lo + by), to: fromAstroYear(hi + by) };
}

/**
 * A linear projection over a window.
 *
 * Linear on purpose. The main chart's scale is piecewise-logarithmic so that
 * 4.5 billion years fit on one axis; across the few centuries a card covers,
 * that curve would only distort the comparison the strip exists to make.
 *
 * Shaped to what layout.js's packLane needs - from, to and project - so the
 * row stacking is shared with the main chart rather than written twice.
 */
export function linearView(from, to, widthPx) {
  const lo = astro(from);
  const span = Math.max(1, astro(to) - lo);
  return {
    from,
    to,
    widthPx,
    project: (year) => ((astro(year) - lo) / span) * widthPx,
  };
}

/** Round years to label the strip's axis. */
export function ticksFor(from, to, { count = 5 } = {}) {
  const lo = astro(from);
  const hi = astro(to);
  const step = niceStep(Math.max(1, (hi - lo) / count));
  const out = [];
  for (let a = Math.ceil(lo / step) * step; a <= hi; a += step) {
    // Astronomical space has a year 0 - it is 1 BCE - so nothing is skipped
    // here; fromAstroYear puts it back into the numbering people read.
    out.push(fromAstroYear(a));
  }
  return out;
}
