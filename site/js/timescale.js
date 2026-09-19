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

import { BP_EPOCH, DEEP_TIME_BP, formatYear } from './format.js';

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

/** Next rung up the 1/2/5 ladder. */
function nextStep(step) {
  const base = 10 ** Math.floor(Math.log10(step) + 1e-9);
  const mantissa = Math.round(step / base);
  if (mantissa < 2) return 2 * base;
  if (mantissa < 5) return 5 * base;
  return 10 * base;
}

const TICK_SAMPLES = 9;
const MAX_TICKS = 12;

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

    if (toAstro(nextTo) - toAstro(nextFrom) < 1) {
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

  /**
   * Ticks spaced evenly on screen, then snapped to round years.
   *
   * Sampling in unit space rather than year space is what keeps the axis
   * readable: on a scale this compressed, evenly spaced round years would pile
   * up at one end.
   *
   * All the arithmetic happens in ASTRONOMICAL years. Historical numbering has
   * no year 0, so snapping raw historical values near the boundary both picks
   * inconsistent steps - leaving a ragged ladder for any window spanning BCE to
   * CE - and can land on year 0 itself, which formatYear rejects.
   */
  function ticks() {
    const samples = [];
    for (let i = 0; i <= TICK_SAMPLES; i++) {
      samples.push(unitToYear(uFrom + (i / TICK_SAMPLES) * uSpan));
    }
    // Spacing is measured astronomically so the missing year 0 does not inflate
    // a gap that straddles it; snapping stays in historical years so the labels
    // come out round - astronomical rounding yields "81 BCE" for astro -80.
    const spaced = samples.map(toAstro);

    const stepFor = new Map(); // keyed by historical year
    for (let i = 0; i <= TICK_SAMPLES; i++) {
      const lower = Math.max(i - 1, 0);
      const upper = Math.min(i + 1, TICK_SAMPLES);
      // Divide by the intervals actually spanned: the first and last samples
      // have one neighbour, not two, and halving their gap would pick a finer
      // step for them than for the middle of the axis.
      const spacing = Math.abs(spaced[upper] - spaced[lower]) / (upper - lower);

      const bp = BP_EPOCH - spaced[i];
      let step;
      let snapped;

      if (bp >= DEEP_TIME_BP) {
        // Deep-time labels show years before present, so snap the BP value:
        // snapping the year gives "602 ka". Cap the step at half the sample's
        // magnitude too, or a sample at -430 Ma whose neighbours are a billion
        // years away rounds to zero and every label piles onto the present.
        step = niceStep(Math.min(spacing, Math.abs(bp) / 2));
        snapped = fromAstro(BP_EPOCH - Math.round(bp / step) * step);
      } else {
        // No magnitude cap here. Inside recorded history the spacing alone is
        // the right step, and capping by |year| would give a sample landing
        // near year 0 a finer step than its neighbours - which is exactly what
        // made windows spanning BCE to CE come out ragged.
        step = niceStep(spacing);
        snapped = Math.round(samples[i] / step) * step;
      }

      // No year 0 to snap onto. Drop it rather than nudging it to 1, which
      // would collide with a neighbouring tick.
      if (snapped === 0) continue;
      if (snapped < lo || snapped > hi) continue;
      if (!stepFor.has(snapped)) stepFor.set(snapped, step);
    }

    // When every sample agreed on a step the window is effectively uniform, so
    // lay the ticks out on that step directly. Snapping samples individually
    // can round two of them onto the same year, and the dedupe then leaves a
    // hole in what should read as an even sequence.
    const steps = new Set(stepFor.values());
    if (steps.size === 1 && stepFor.size >= 2) {
      // Climb the ladder until the count fits rather than abandoning
      // uniformity: giving up here drops back to per-sample snapping, which
      // rounds an even 4.4-year spacing onto alternating 4s and 6s.
      let step = [...steps][0];
      for (let guard = 0; guard < 24; guard++) {
        const uniform = new Map();
        for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) {
          if (y !== 0) uniform.set(y, step);
        }
        if (uniform.size < 2) break;
        if (uniform.size <= MAX_TICKS) return finish(uniform);
        step = nextStep(step);
      }
    }

    if (stepFor.size < 2) {
      // A window barely a year wide. Label the two whole years bracketing it,
      // which may sit marginally outside the window and simply clip.
      const first = Math.round(lo) || 1;
      stepFor.clear();
      stepFor.set(first, 1);
      stepFor.set(first + 1 === 0 ? 1 : first + 1, 1);
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
    // Elapsed years. Raw subtraction counts the non-existent year 0, so a
    // window straddling the boundary reads one year wider than it is - and the
    // one-year zoom clamp would then stop a full year early.
    span: toAstro(hi) - toAstro(lo),
    project,
    unproject,
    zoomAbout,
    pan,
    ticks,
  };
}
