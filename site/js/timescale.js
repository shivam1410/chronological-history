/**
 * Anchored piecewise-logarithmic time scale. Pure: no DOM, no fetch.
 *
 * Mapping 4.54 billion years onto one axis needs compression, but a plain
 * logarithm compresses the wrong end - it hands the Pleistocene about a third
 * of the bar and leaves all of recorded history with a twelfth. The anchors
 * below allocate the budget deliberately instead: deep time keeps roughly 42%,
 * and everything since 3000 BCE gets 48%.
 *
 * Within a segment the interpolation is linear in sp-space (log of years before
 * present), so the curve stays smooth and strictly monotonic end to end.
 */

import { BP_EPOCH, formatYear } from './format.js';

export const ORIGIN_YEAR = -4_540_000_000;

/** Current year. The last anchor tracks it so the scale never stops short. */
export function presentYear() {
  return new Date().getFullYear();
}

const PRESENT = presentYear();

/** [historical year, unit position]. Both sequences must increase. */
export const ANCHORS = [
  [ORIGIN_YEAR, 0.0],
  [-541_000_000, 0.1],
  [-66_000_000, 0.2],
  [-2_580_000, 0.3],
  [-11_700, 0.42],
  [-3_000, 0.52],
  [-500, 0.62],
  [500, 0.72],
  [1_500, 0.84],
  [1_800, 0.92],
  [PRESENT, 1.0],
];

// The public astro()/historical() in format.js reject year zero, which is right
// for data. The scale is a continuous function and has to pass smoothly through
// the boundary, so it uses unguarded equivalents.
const toAstro = (year) => (year < 0 ? year + 1 : year);
const fromAstro = (a) => (a <= 0 ? a - 1 : a);

/** log10 of years-before-present, offset so the argument stays positive. */
const sp = (year) => Math.log10(BP_EPOCH - toAstro(year) + 1000);

const yearFromSp = (s) => fromAstro(BP_EPOCH - (10 ** s - 1000));

const ANCHOR_SP = ANCHORS.map(([year]) => sp(year));
const LAST = ANCHORS.length - 1;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function segmentByYear(year) {
  let i = 0;
  while (i < LAST - 1 && ANCHORS[i + 1][0] <= year) i++;
  return i;
}

function segmentByUnit(unit) {
  let i = 0;
  while (i < LAST - 1 && ANCHORS[i + 1][1] <= unit) i++;
  return i;
}

/** Historical year -> position in [0, 1]. Clamps outside the domain. */
export function yearToUnit(year) {
  if (year <= ORIGIN_YEAR) return 0;
  if (year >= PRESENT) return 1;
  const i = segmentByYear(year);
  const f = (ANCHOR_SP[i] - sp(year)) / (ANCHOR_SP[i] - ANCHOR_SP[i + 1]);
  return ANCHORS[i][1] + f * (ANCHORS[i + 1][1] - ANCHORS[i][1]);
}

/** Position in [0, 1] -> historical year. Inverse of yearToUnit. */
export function unitToYear(unit) {
  if (unit <= 0) return ORIGIN_YEAR;
  if (unit >= 1) return PRESENT;
  const i = segmentByUnit(unit);
  const f = (unit - ANCHORS[i][1]) / (ANCHORS[i + 1][1] - ANCHORS[i][1]);
  return yearFromSp(ANCHOR_SP[i] + f * (ANCHOR_SP[i + 1] - ANCHOR_SP[i]));
}

/** Largest 1/2/5 x 10^k step not exceeding `magnitude`, never below one year. */
function niceStep(magnitude) {
  if (!(magnitude > 1)) return 1;
  const base = 10 ** Math.floor(Math.log10(magnitude));
  const ratio = magnitude / base;
  const mult = ratio >= 5 ? 5 : ratio >= 2 ? 2 : 1;
  return Math.max(1, mult * base);
}

const TICK_SAMPLES = 9;

/**
 * A window onto the scale, rendered linearly in sp-space.
 *
 * Views are immutable: zoomAbout and pan return new ones.
 */
export function createView(from, to, widthPx) {
  const lo = clamp(Math.min(from, to), ORIGIN_YEAR, PRESENT);
  const hi = clamp(Math.max(from, to), ORIGIN_YEAR, PRESENT);

  const spFrom = sp(lo);
  const spTo = sp(hi);
  const spSpan = spFrom - spTo; // positive: sp decreases as the year increases

  const project = (year) => ((spFrom - sp(year)) / spSpan) * widthPx;
  const unproject = (px) => yearFromSp(spFrom - (px / widthPx) * spSpan);

  function zoomAbout(px, factor) {
    const fraction = px / widthPx;
    const anchorSp = spFrom - fraction * spSpan;
    const nextSpan = spSpan * factor;
    let nextFrom = yearFromSp(anchorSp + fraction * nextSpan);
    let nextTo = yearFromSp(anchorSp - (1 - fraction) * nextSpan);

    nextFrom = clamp(nextFrom, ORIGIN_YEAR, PRESENT);
    nextTo = clamp(nextTo, ORIGIN_YEAR, PRESENT);

    if (nextTo - nextFrom < 1) {
      // Never collapse below a one-year window.
      const mid = clamp((nextFrom + nextTo) / 2, ORIGIN_YEAR + 0.5, PRESENT - 0.5);
      nextFrom = mid - 0.5;
      nextTo = mid + 0.5;
    }
    return createView(nextFrom, nextTo, widthPx);
  }

  function pan(px) {
    const shift = (px / widthPx) * spSpan;
    return createView(yearFromSp(spFrom - shift), yearFromSp(spTo - shift), widthPx);
  }

  /**
   * Ticks spaced evenly on screen, then snapped to round years.
   *
   * Sampling in unit space rather than year space is what keeps the axis
   * readable: on a scale this compressed, evenly spaced round years would pile
   * up at one end.
   */
  function ticks() {
    const uFrom = yearToUnit(lo);
    const uTo = yearToUnit(hi);
    const samples = [];
    for (let i = 0; i <= TICK_SAMPLES; i++) {
      samples.push(unitToYear(uFrom + (i / TICK_SAMPLES) * (uTo - uFrom)));
    }

    const stepFor = new Map();
    for (let i = 0; i <= TICK_SAMPLES; i++) {
      const before = samples[Math.max(i - 1, 0)];
      const after = samples[Math.min(i + 1, TICK_SAMPLES)];
      const step = niceStep(Math.abs(after - before) / 2);
      let year = Math.round(samples[i] / step) * step;
      if (year === 0) year = 1; // no year zero
      if (year < lo || year > hi) continue;
      if (!stepFor.has(year)) stepFor.set(year, step);
    }

    if (stepFor.size < 2) {
      // Degenerate window: fall back to labelling its own edges.
      stepFor.set(Math.ceil(lo), 1);
      stepFor.set(Math.floor(hi), 1);
    }

    return [...stepFor.keys()]
      .sort((a, b) => a - b)
      .map((year) => ({
        year,
        label: formatYear(year),
        major: Math.abs(year) % (stepFor.get(year) * 5) === 0,
      }));
  }

  return {
    from: lo,
    to: hi,
    widthPx,
    span: hi - lo,
    project,
    unproject,
    zoomAbout,
    pan,
    ticks,
  };
}
