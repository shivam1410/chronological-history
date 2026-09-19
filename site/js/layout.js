/**
 * Lane geometry. Pure: no DOM, no fetch, no storage.
 *
 * Packing happens in pixel space rather than year space. The scale is
 * logarithmic, so "four years apart" means something different at 66 Ma than at
 * 1555 - but "four pixels apart" is what actually decides whether two bars read
 * as separate, at any zoom level.
 */

const DEFAULTS = {
  maxRows: 6,
  gapPx: 4,
  minWidthPx: 3,
  laneKey: 'lane',
};

/** Entries overlapping the view's window. Touching an edge counts. */
export function cull(entries, view) {
  return entries.filter((entry) => entry.eMax >= view.from && entry.sMin <= view.to);
}

function measure(entry, view, minWidthPx) {
  const x0 = view.project(entry.sMin);
  const x1 = view.project(entry.eMax);
  const point = entry.sMin === entry.eMax;
  return { entry, x0, x1, w: Math.max(minWidthPx, x1 - x0), point };
}

/**
 * First-fit interval packing for one lane.
 *
 * Returns `{ rows, hidden }`. Overflow past `maxRows` is counted, never
 * discarded: `rows.flat().length + hidden` always equals the number of entries
 * that were in view, so the renderer can show a truthful "+N more".
 */
export function packLane(entries, view, options = {}) {
  const { maxRows, gapPx, minWidthPx } = { ...DEFAULTS, ...options };

  const items = cull(entries, view)
    .map((entry) => measure(entry, view, minWidthPx))
    // Widest first at a shared start, so a long bar claims the top row and the
    // short ones fill in beneath it rather than the other way round.
    .sort((a, b) => a.x0 - b.x0 || b.w - a.w || (a.entry.id < b.entry.id ? -1 : 1));

  const rows = [];
  const ends = []; // right edge of each row's last item, including the gap
  let hidden = 0;

  for (const item of items) {
    // Items arrive in ascending x0, so only each row's last item can collide.
    let placed = false;
    for (let r = 0; r < rows.length; r++) {
      if (ends[r] <= item.x0) {
        rows[r].push(item);
        ends[r] = item.x0 + item.w + gapPx;
        placed = true;
        break;
      }
    }
    if (placed) continue;

    if (rows.length < maxRows) {
      rows.push([item]);
      ends.push(item.x0 + item.w + gapPx);
    } else {
      hidden += 1;
    }
  }

  return { rows, hidden };
}

/**
 * Pack every lane, in the given order, skipping lanes with nothing in view.
 *
 * `laneKey` chooses the grouping field: `lane` for the default view, `region`
 * when a zoomed-in window expands a lane into its sub-regions.
 *
 * An entry whose group is not in `laneOrder` falls through to `global` rather
 * than disappearing - a lane missing from the taxonomy is a data bug, and a
 * silently dropped entry hides it.
 */
export function packLanes(entries, laneOrder, view, options = {}) {
  const { laneKey } = { ...DEFAULTS, ...options };
  const known = new Set(laneOrder);
  const fallback = known.has('global') ? 'global' : laneOrder[laneOrder.length - 1];

  const byLane = new Map(laneOrder.map((lane) => [lane, []]));
  for (const entry of cull(entries, view)) {
    // Try the requested key, then the entry's lane, then global. The middle
    // step matters: when only some lanes expand into sub-regions, an entry
    // tagged `rome` must fall back to `europe`, not all the way to `global`.
    const group = [entry[laneKey], entry.lane].find((id) => known.has(id)) ?? fallback;
    byLane.get(group)?.push(entry);
  }

  return laneOrder
    .filter((lane) => byLane.get(lane).length > 0)
    .map((lane) => ({ lane, ...packLane(byLane.get(lane), view, options) }));
}
