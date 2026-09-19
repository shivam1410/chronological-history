/**
 * Inverted-index search over titles and aliases. Pure: no DOM, no fetch.
 *
 * The index is built once from the spine at load. Searching then costs a binary
 * search per query word plus a set intersection, rather than a scan of every
 * entry per keystroke - which is what keeps typing responsive once the dataset
 * is tens of thousands of entries rather than tens.
 */

/** Lowercase, strip diacritics, so "rgveda" finds "Ṛgveda". */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const tokenize = (text) => normalize(text).split(/[^a-z0-9]+/).filter(Boolean);

/** Build the index. `entries` are spine rows. */
export function buildIndex(entries) {
  const postings = new Map();
  const records = entries.map((entry, i) => {
    const aliases = entry.alias ? entry.alias.split('|') : [];
    const record = {
      entry,
      title: normalize(entry.title),
      aliases: aliases.map(normalize),
    };
    const seen = new Set([
      ...tokenize(entry.title),
      ...aliases.flatMap(tokenize),
    ]);
    for (const token of seen) {
      let list = postings.get(token);
      if (!list) postings.set(token, (list = []));
      list.push(i);
    }
    return record;
  });

  return {
    size: records.length,
    records,
    postings,
    tokens: [...postings.keys()].sort(),
  };
}

/** Indices of the sorted token list whose tokens start with `prefix`. */
function prefixRange(tokens, prefix) {
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < tokens.length && tokens[end].startsWith(prefix)) end += 1;
  return [lo, end];
}

function matchesFor(index, word, { asPrefix }) {
  const found = new Set();
  const exact = index.postings.get(word);
  if (exact) for (const i of exact) found.add(i);
  if (!asPrefix) return found;

  const [from, to] = prefixRange(index.tokens, word);
  for (let t = from; t < to; t++) {
    for (const i of index.postings.get(index.tokens[t])) found.add(i);
  }
  return found;
}

/**
 * Rank a record against the whole query string.
 *
 * An exact title beats a title that merely starts with the query, which beats a
 * match on a later word, which beats a match that only came from an alias.
 */
function score(record, query) {
  const { title, aliases } = record;
  if (title === query) return 1000;
  if (title.startsWith(query)) return 900;
  if (aliases.some((a) => a === query)) return 850;
  if (aliases.some((a) => a.startsWith(query))) return 800;
  if (title.includes(query)) return 700;
  if (aliases.some((a) => a.includes(query))) return 600;
  return 500;
}

export function search(index, rawQuery, { limit = 20 } = {}) {
  const query = normalize(rawQuery).trim();
  const words = tokenize(rawQuery);
  if (!words.length) return [];

  // Every word must match; the last is treated as a prefix so results appear
  // while the word is still being typed.
  let candidates = null;
  words.forEach((word, i) => {
    const isLast = i === words.length - 1;
    const found = matchesFor(index, word, { asPrefix: isLast });
    candidates = candidates === null
      ? found
      : new Set([...candidates].filter((x) => found.has(x)));
  });
  if (!candidates || candidates.size === 0) return [];

  return [...candidates]
    .map((i) => {
      const record = index.records[i];
      return { entry: record.entry, score: score(record, query) };
    })
    .sort((a, b) =>
      b.score - a.score
      || b.entry.imp - a.entry.imp
      || a.entry.sMin - b.entry.sMin
      || (a.entry.id < b.entry.id ? -1 : 1))
    .slice(0, limit);
}
