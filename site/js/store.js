/**
 * Fetches and caches the generated data bundles.
 *
 * The spine is complete on purpose: search, the year slice and visible-window
 * culling are all interval queries over the whole dataset, so they have to be
 * answerable without a round trip. Prose lives in the era bundles and is
 * fetched only when something actually needs to display it.
 */

const SPINE_FIELDS = [
  'id', 'title', 'kind', 'lane', 'region',
  'sMin', 'sMax', 'eMin', 'eMax',
  'imp', 'bucket', 'flags',
];

export const FLAG_UNCERTAIN_START = 1;
export const FLAG_UNCERTAIN_END = 2;
export const FLAG_ONGOING = 4;
export const FLAG_CONTESTED = 8;
export const FLAG_IMPORTED = 16;

export class DataError extends Error {
  constructor(url, cause) {
    super(`Could not load ${url}`);
    this.name = 'DataError';
    this.url = url;
    this.cause = cause;
  }
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (cause) {
    throw new DataError(url, cause);
  }
  if (!response.ok) throw new DataError(url, new Error(`HTTP ${response.status}`));
  try {
    return await response.json();
  } catch (cause) {
    throw new DataError(url, cause);
  }
}

/** Turn the compact array-of-arrays rows into objects, once, at load. */
function decodeSpine(payload) {
  const order = payload.fields.map((field) => SPINE_FIELDS.indexOf(field));
  if (order.some((i) => i < 0)) {
    throw new DataError('data/spine.json', new Error('unexpected field list'));
  }
  return payload.rows.map((row) => {
    const entry = {};
    payload.fields.forEach((field, i) => { entry[field] = row[i]; });
    return entry;
  });
}

export async function loadIndex(base = 'data') {
  const [meta, spinePayload] = await Promise.all([
    getJson(`${base}/meta.json`),
    getJson(`${base}/spine.json`),
  ]);
  return { meta, entries: decodeSpine(spinePayload) };
}

const eraCache = new Map();

/** Detail bundle for one era bucket. Cached; failures are not cached. */
export async function loadEra(bucket, base = 'data') {
  if (eraCache.has(bucket)) return eraCache.get(bucket);
  const pending = getJson(`${base}/eras/${bucket}.json`).catch((error) => {
    eraCache.delete(bucket);
    throw error;
  });
  eraCache.set(bucket, pending);
  return pending;
}
