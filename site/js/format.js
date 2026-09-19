/**
 * Pure display and year-arithmetic helpers. No DOM, no fetch, no storage.
 *
 * Mirrors pipeline/model.py: years are HISTORICAL (-1 is 1 BCE, 1 is 1 CE, and
 * there is no year 0), and every calculation routes through astro() first.
 */

/** Geological "before present" is measured from 1950 CE by convention. */
export const BP_EPOCH = 1950;

/** Historical year -> astronomical year. Throws on the non-existent year 0. */
export function astro(year) {
  if (year === 0) throw new RangeError('there is no year zero; use -1 or 1');
  return year < 0 ? year + 1 : year;
}

/** Astronomical year -> historical year. Inverse of astro(). */
export function historical(astroYear) {
  return astroYear <= 0 ? astroYear - 1 : astroYear;
}

/** Elapsed years between two historical years (1526..1857 is 331). */
export function duration(start, end) {
  return astro(end) - astro(start);
}

/** Years before 1950 CE. Negative for years after 1950. */
export function beforePresent(year) {
  return BP_EPOCH - astro(year);
}

/** Trim a number to at most `digits` significant figures, dropping zeros. */
function sig(value, digits = 3) {
  return String(Number(value.toPrecision(digits)));
}

/**
 * Format an arbitrary year for an axis tick or a report.
 *
 * Switches to ka/Ma/Ga for deep time, because a tick at -65,998,051 has to read
 * "66 Ma" rather than a ten-digit number.
 */
export function formatYear(year) {
  const bp = beforePresent(year);
  if (bp >= 1e9) return `${sig(bp / 1e9)} Ga`;
  if (bp >= 1e6) return `${sig(bp / 1e6)} Ma`;
  if (bp >= 1e4) return `${sig(bp / 1e3)} ka`;
  if (year < 0) return `${-year} BCE`;
  return year < 1000 ? `${year} CE` : String(year);
}

/** Human-readable elapsed span. */
export function formatDuration(years) {
  const n = Math.abs(years);
  if (n >= 1e9) return `${sig(n / 1e9)} billion years`;
  if (n >= 1e6) return `${sig(n / 1e6, 4)} million years`;
  if (n >= 1e4) return `${n.toLocaleString('en-US')} years`;
  return n === 1 ? '1 year' : `${n} years`;
}

/** Age of someone born in `birthYear` as of `year`. */
export function formatAge(birthYear, year) {
  return `age ${duration(birthYear, year)}`;
}

/** "year 29 of 331" for an entry underway in the queried year. */
export function formatElapsed(startYear, endYear, year) {
  return `year ${duration(startYear, year)} of ${duration(startYear, endYear)}`;
}
