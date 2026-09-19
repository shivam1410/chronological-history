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
