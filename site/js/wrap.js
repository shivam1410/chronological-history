/**
 * Text wrapping for the lane gutter. Pure: takes a measuring function rather
 * than a canvas, so it is testable without a DOM.
 *
 * Truncation was the old behaviour and it was the wrong one - at phone width
 * every multi-word lane came out as "Centr...", "Ameri...", "Scien...", which
 * names nothing. Wrapping keeps the name whole; only a single word too wide
 * for the column is ever cut, and then only that word.
 */

const ELLIPSIS = '…';

/**
 * @param {string} text        the label to lay out
 * @param {number} maxWidth    px available per line
 * @param {number} maxLines    hard cap on lines
 * @param {(s: string) => number} measure  rendered width of a string, in px
 * @returns {string[]} one string per line, at least one
 */
export function wrapText(text, maxWidth, maxLines, measure) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // The line just started is still pending; stopping here would drop it, so
    // the cap is checked against what is already committed.
    if (lines.length === maxLines) return lines.map((l) => clip(l, maxWidth, measure));
  }
  if (lines.length < maxLines && line) lines.push(line);

  return lines.map((l) => clip(l, maxWidth, measure));
}

/** Cut a single over-wide word down to fit, marking the cut. */
function clip(text, maxWidth, measure) {
  if (measure(text) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}${ELLIPSIS}`) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}${ELLIPSIS}`;
}

/** Space, hyphen, en dash, em dash - anywhere a title can be cut cleanly. */
const BREAKS = /[\s\u2010\u2011\u2012\u2013\u2014-]/;

/**
 * As much of a title as fits, cut at a separator rather than mid-word.
 *
 * A bar too narrow for its whole title used to show nothing at all, which
 * wastes space a reader could have used: "Himalayan Orogeny - India collides
 * with Eurasia" becomes "Himalayan Orogeny…" rather than a blank capsule. If
 * not even the first word fits, nothing is drawn - half a word is noise.
 *
 * @param {(s: string) => number} measure  rendered width, in px
 */
export function clipToWords(text, maxWidth, measure) {
  const full = String(text ?? '');
  if (!full) return '';
  if (measure(full) <= maxWidth) return full;

  // Each token carries its own trailing separators, so the cut lands after a
  // word and the separator never starts the next chunk.
  const tokens = full.match(/[^\s\u2010-\u2014-]+[\s\u2010-\u2014-]*/g) ?? [];
  let kept = '';
  for (const token of tokens) {
    const candidate = kept + token;
    if (measure(`${trimBreaks(candidate)}${ELLIPSIS}`) > maxWidth) break;
    kept = candidate;
  }

  const out = trimBreaks(kept);
  // "The…" is not worth the space it takes: an article alone names nothing,
  // so a bar that can only hold one falls back to showing no label at all.
  if (!out || ARTICLES.has(out.toLowerCase())) return '';
  return `${out}${ELLIPSIS}`;
}

const ARTICLES = new Set(['the', 'a', 'an']);

/** Drop trailing separators, so a cut never reads as "Ming -…". */
function trimBreaks(text) {
  let out = text;
  while (out && BREAKS.test(out[out.length - 1])) out = out.slice(0, -1);
  return out;
}
