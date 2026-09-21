/**
 * What the site calls itself, which depends on where you are reading it.
 *
 * Pure: it is handed the environment rather than reading it, so the decision
 * can be tested without a browser and without pretending to be in Mumbai.
 *
 * There is no geolocation here and no request to anybody's IP lookup. The
 * signals are the two the browser already volunteers - the timezone the
 * machine is set to, and the locales the reader has chosen - so nothing about
 * the reader leaves the page.
 */

export const DEFAULT_TITLE = 'Chronological History';
export const INDIA_TITLE = 'Aap chronology samajhiye';

/* Asia/Calcutta is the older name for the same zone and is still what some
   systems report, so both spellings count. */
const INDIA_ZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);

/**
 * Is the reader in India?
 *
 * Geography first: the timezone is a claim about where the machine is. A
 * locale region of IN counts too, because someone who has set their browser
 * to en-IN or hi-IN has told us the same thing more deliberately.
 *
 * A bare language subtag does not count. "hi" says Hindi, not India, and
 * Hindi is read in plenty of places this title would land oddly.
 */
export function inIndia({ timeZone, languages } = {}) {
  if (INDIA_ZONES.has(timeZone)) return true;
  return (languages ?? []).some(hasIndiaRegion);
}

/**
 * Does a BCP-47 tag carry the region IN - "en-IN", "hi-Deva-IN"?
 *
 * The region is never the first subtag, which matters: "in" on its own is the
 * deprecated code for Indonesian, and reading it as India would put a Hindi
 * pun in front of readers in Jakarta.
 */
function hasIndiaRegion(tag) {
  const parts = String(tag ?? '').split('-');
  return parts.slice(1).some((part) => part.toLowerCase() === 'in');
}

/** The name to show, given where the reader is. */
export function siteTitle(env) {
  return inIndia(env) ? INDIA_TITLE : DEFAULT_TITLE;
}

/**
 * What this environment looks like to the functions above.
 *
 * Separated from them so the impure half - the part that touches Intl and
 * navigator - is three lines with nothing to decide, and every branch that
 * does decide something is testable.
 */
export function readEnvironment(global = globalThis) {
  let timeZone;
  try {
    timeZone = global.Intl?.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Intl is present everywhere this site runs, but resolvedOptions has
    // thrown in locked-down environments before now. An unknown zone is not
    // an error - it just means the locales decide on their own.
    timeZone = undefined;
  }
  const nav = global.navigator;
  const languages = nav?.languages?.length ? [...nav.languages]
    : nav?.language ? [nav.language]
    : [];
  return { timeZone, languages };
}
