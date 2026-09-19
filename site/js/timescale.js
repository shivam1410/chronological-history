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
 * A window onto the scale, rendered linearly in UNIT space.
 *
 * Unit space, not raw sp-space: the anchors are the whole point of this module,
 * and projecting through sp directly bypasses them - recorded history collapses
 * back to about a twelfth of the axis. Inside a single anchor segment unit is
 * linear in sp anyway, so a zoomed window is still near-linear in years.
 *
 * Views are immutable: zoomAbout and pan return new ones.
 */
export function createView(from, to, widthPx) {
  const lo = clamp(Math.min(from, to), ORIGIN_YEAR, PRESENT);
  const hi = clamp(Math.max(from, to), ORIGIN_YEAR, PRESENT);

  const uFrom = yearToUnit(lo);
  const uTo = yearToUnit(hi);
  const uSpan = uTo - uFrom || Number.EPSILON;

  const project = (year) => ((yearToUnit(year) - uFrom) / uSpan) * widthPx;
  const unproject = (px) => unitToYear(uFrom + (px / widthPx) * uSpan);

  function zoomAbout(px, factor) {
    const fraction = px / widthPx;
    const anchorU = uFrom + fraction * uSpan;
    const nextSpan = uSpan * factor;

    let nextFrom = unitToYear(clamp(anchorU - fraction * nextSpan, 0, 1));
    let nextTo = unitToYear(clamp(anchorU + (1 - fraction) * nextSpan, 0, 1));

    if (nextTo - nextFrom < 1) {
      // Never collapse below a one-year window.
      const mid = clamp((nextFrom + nextTo) / 2, ORIGIN_YEAR + 0.5, PRESENT - 0.5);
      nextFrom = mid - 0.5;
      nextTo = mid + 0.5;
    }
    return createView(nextFrom, nextTo, widthPx);
  }

  function pan(px) {
    const shift = (px / widthPx) * uSpan;
    return createView(
      unitToYear(clamp(uFrom + shift, 0, 1)),
      unitToYear(clamp(uTo + shift, 0, 1)),
      widthPx,
    );
  }

  function ticks() {
    const samples = [];
    for (let i = 0; i <= TICK_SAMPLES; i++) {
      samples.push(unitToYear(uFrom + (i / TICK_SAMPLES) * (uTo - uFrom)));
    }

    const stepFor = new Map();
    for (let i = 0; i <= TICK_SAMPLES; i++) {
      const lower = Math.max(i - 1, 0);
      const upper = Math.min(i + 1, TICK_SAMPLES);
      // Divide by the intervals actually spanned: the first and last samples
      // have one neighbour, not two, and halving their gap would pick a finer
      // step for them than for the middle of the axis.
      const spacing = Math.abs(samples[upper] - samples[lower]) / (upper - lower);

      // Cap the step at half the sample's own magnitude. Without this a sample
      // at -430 Ma, whose neighbours are a billion years away, rounds to zero
      // and every deep-time label collapses onto the present.
      const bp = BP_EPOCH - toAstro(samples[i]);
      const deep = bp >= 1e4; // formatYear switches to ka/Ma/Ga here

      // Deep-time labels show years before present, so snapping the historical
      // year gives values like "602 ka". Snap the BP value instead.
      const basis = deep ? bp : samples[i];
      const step = niceStep(Math.min(spacing, Math.abs(basis) / 2));
      const snapped = Math.round(basis / step) * step;

      let year = deep ? fromAstro(BP_EPOCH - snapped) : snapped;
      if (year === 0) year = 1; // no year zero
      if (year < lo || year > hi) continue;
      if (!stepFor.has(year)) stepFor.set(year, step);
    }

    // When every sample agreed on a step the window is effectively uniform, so
    // lay the ticks out on that step directly. Snapping samples individually
    // can round two of them onto the same year, and the dedupe then leaves a
    // hole in what should read as an even sequence.
    const steps = new Set(stepFor.values());
    if (steps.size === 1 && stepFor.size >= 2) {
      const step = [...steps][0];
      const uniform = new Map();
      for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) {
        if (y !== 0) uniform.set(y, step);
      }
      if (uniform.size >= 2 && uniform.size <= 12) return finish(uniform);
    }

    if (stepFor.size < 2) {
      // Degenerate window: fall back to labelling its own edges.
      stepFor.set(Math.ceil(lo), 1);
      stepFor.set(Math.floor(hi), 1);
    }

    return finish(stepFor);
  }

  function finish(stepFor) {
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
