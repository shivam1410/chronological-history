import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cull, hitRow, packLane, packLanes } from './layout.js';

/** Linear stand-in for a view, so expectations are obvious arithmetic. */
function fakeView(from, to, widthPx) {
  return {
    from,
    to,
    widthPx,
    project: (year) => ((year - from) / (to - from)) * widthPx,
  };
}

const entry = (id, sMin, eMax, extra = {}) => ({
  id, title: id, kind: 'polity', lane: 'india',
  sMin, sMax: sMin, eMin: eMax, eMax, imp: 3, flags: 0, ...extra,
});

describe('cull', () => {
  const view = fakeView(1000, 2000, 1000);

  test('keeps entries overlapping the window', () => {
    const kept = cull([entry('a', 1400, 1600)], view);
    assert.equal(kept.length, 1);
  });

  test('keeps an entry spanning the whole window', () => {
    assert.equal(cull([entry('a', 500, 2500)], view).length, 1);
  });

  test('keeps entries touching either edge', () => {
    assert.equal(cull([entry('a', 500, 1000), entry('b', 2000, 2500)], view).length, 2);
  });

  test('drops entries entirely outside', () => {
    assert.equal(cull([entry('a', 100, 900), entry('b', 2100, 2200)], view).length, 0);
  });
});

describe('packLane', () => {
  const view = fakeView(0, 1000, 1000); // one year per pixel

  test('disjoint intervals share one row', () => {
    const { rows, hidden } = packLane(
      [entry('a', 0, 100), entry('b', 200, 300), entry('c', 400, 500)], view);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].length, 3);
    assert.equal(hidden, 0);
  });

  test('two overlapping intervals need two rows', () => {
    const { rows } = packLane([entry('a', 0, 500), entry('b', 250, 700)], view);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0].entry.id, 'a');
    assert.equal(rows[1][0].entry.id, 'b');
  });

  test('a nested interval needs its own row', () => {
    const { rows } = packLane([entry('outer', 0, 900), entry('inner', 300, 400)], view);
    assert.equal(rows.length, 2);
  });

  test('an interval spanning the window pushes everything else down', () => {
    const { rows } = packLane(
      [entry('span', 0, 1000), entry('a', 100, 200), entry('b', 300, 400)], view);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].length, 1);
    assert.equal(rows[1].length, 2); // a and b are disjoint, so they share row 2
  });

  test('the 4px minimum gap separates bars that do not overlap in years', () => {
    // 100..200 and 202..300 are two years apart - under the 4px gap at this
    // scale, so they must not sit flush against each other on one row.
    const { rows } = packLane([entry('a', 100, 200), entry('b', 202, 300)], view);
    assert.equal(rows.length, 2);
  });

  test('a gap wider than 4px keeps them on one row', () => {
    const { rows } = packLane([entry('a', 100, 200), entry('b', 210, 300)], view);
    assert.equal(rows.length, 1);
  });

  test('the row cap moves overflow into hidden rather than dropping it', () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`, 0, 1000));
    const { rows, hidden } = packLane(entries, view, { maxRows: 6 });
    assert.equal(rows.length, 6);
    assert.equal(hidden, 4);
    assert.equal(rows.flat().length + hidden, entries.length);
  });

  test('nothing is ever dropped silently', () => {
    const entries = Array.from({ length: 25 }, (_, i) => entry(`e${i}`, i * 10, i * 10 + 400));
    const { rows, hidden } = packLane(entries, view, { maxRows: 4 });
    assert.equal(rows.flat().length + hidden, entries.length);
  });

  test('longer bars are placed first when two start together', () => {
    const { rows } = packLane([entry('short', 100, 200), entry('long', 100, 800)], view);
    assert.equal(rows[0][0].entry.id, 'long');
  });

  test('point events get a minimum width so labels do not collide', () => {
    const { rows } = packLane([entry('p', 500, 500)], view);
    assert.ok(rows[0][0].w >= 3);
    assert.equal(rows[0][0].point, true);
  });

  test('packing is stable across runs', () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(`e${i}`, i * 40, i * 40 + 300));
    const a = packLane(entries, view);
    const b = packLane(entries, view);
    assert.deepEqual(
      a.rows.map((r) => r.map((i) => i.entry.id)),
      b.rows.map((r) => r.map((i) => i.entry.id)),
    );
  });

  test('items carry projected geometry', () => {
    const { rows } = packLane([entry('a', 200, 400)], view);
    const item = rows[0][0];
    assert.equal(item.x0, 200);
    assert.equal(item.x1, 400);
    assert.equal(item.w, 200);
  });

  test('an empty lane packs to no rows', () => {
    const { rows, hidden } = packLane([], view);
    assert.deepEqual(rows, []);
    assert.equal(hidden, 0);
  });
});

describe('packLanes', () => {
  const view = fakeView(0, 1000, 1000);

  test('groups by lane and preserves the given order', () => {
    const entries = [
      entry('a', 0, 100, { lane: 'europe' }),
      entry('b', 0, 100, { lane: 'india' }),
    ];
    const lanes = packLanes(entries, ['india', 'europe'], view);
    assert.deepEqual(lanes.map((l) => l.lane), ['india', 'europe']);
  });

  test('omits lanes with nothing visible', () => {
    const entries = [entry('a', 0, 100, { lane: 'india' })];
    const lanes = packLanes(entries, ['india', 'europe', 'africa'], view);
    assert.deepEqual(lanes.map((l) => l.lane), ['india']);
  });

  test('every visible entry lands in exactly one lane', () => {
    const entries = [
      entry('a', 0, 100, { lane: 'india' }),
      entry('b', 50, 200, { lane: 'india' }),
      entry('c', 0, 900, { lane: 'europe' }),
      entry('d', 5000, 6000, { lane: 'europe' }), // outside the window
    ];
    const lanes = packLanes(entries, ['india', 'europe'], view);
    const placed = lanes.reduce((n, l) => n + l.rows.flat().length + l.hidden, 0);
    assert.equal(placed, 3);
  });

  test('an unknown lane falls through to global rather than vanishing', () => {
    const entries = [entry('a', 0, 100, { lane: 'atlantis' })];
    const lanes = packLanes(entries, ['india', 'global'], view);
    assert.deepEqual(lanes.map((l) => l.lane), ['global']);
    assert.equal(lanes[0].rows.flat().length, 1);
  });
});

describe('packLanes with a custom grouping key', () => {
  const view = fakeView(0, 1000, 1000);

  test('groups by region when asked, for sub-lane expansion', () => {
    const entries = [
      entry('a', 0, 100, { lane: 'india', region: 'north-india' }),
      entry('b', 0, 100, { lane: 'india', region: 'south-india' }),
    ];
    const lanes = packLanes(entries, ['north-india', 'south-india'], view,
      { laneKey: 'region' });
    assert.deepEqual(lanes.map((l) => l.lane), ['north-india', 'south-india']);
    assert.equal(lanes[0].rows.flat().length, 1);
    assert.equal(lanes[1].rows.flat().length, 1);
  });

  test('an entry whose region is not in the order falls back, not away', () => {
    const entries = [entry('a', 0, 100, { lane: 'india', region: 'deccan' })];
    const lanes = packLanes(entries, ['north-india', 'global'], view,
      { laneKey: 'region' });
    assert.equal(lanes.reduce((n, l) => n + l.rows.flat().length, 0), 1);
  });
});

describe('region grouping falls back to the lane, not to global', () => {
  const view = fakeView(0, 1000, 1000);

  // Only some lanes expand into sub-regions. An entry tagged with a sub-region
  // of a lane that did NOT expand must land in its own lane - dumping it into
  // global puts Roman and Chinese history under "Global / Science & Ideas".
  test('an unexpanded lane keeps its own entries', () => {
    const entries = [
      entry('caesar', 0, 100, { lane: 'europe', region: 'rome' }),
      entry('han', 0, 100, { lane: 'east-asia', region: 'china' }),
      entry('akbar', 0, 100, { lane: 'india', region: 'north-india' }),
    ];
    const lanes = packLanes(entries, ['north-india', 'east-asia', 'europe', 'global'],
      view, { laneKey: 'region' });
    const placed = Object.fromEntries(
      lanes.map((l) => [l.lane, l.rows.flat().map((i) => i.entry.id)]));
    assert.deepEqual(placed.europe, ['caesar']);
    assert.deepEqual(placed['east-asia'], ['han']);
    assert.deepEqual(placed['north-india'], ['akbar']);
    assert.equal(placed.global, undefined);
  });

  test('global still catches an entry whose lane is unknown too', () => {
    const entries = [entry('x', 0, 100, { lane: 'atlantis', region: 'atlantis' })];
    const lanes = packLanes(entries, ['india', 'global'], view, { laneKey: 'region' });
    assert.deepEqual(lanes.map((l) => l.lane), ['global']);
  });
});

describe('hitRow', () => {
  const view = fakeView(0, 1000, 1000);
  const row = packLane(
    [entry('a', 0, 100), entry('b', 300, 400), entry('p', 700, 700)], view).rows[0];

  test('finds the item under the cursor', () => {
    assert.equal(hitRow(row, 50)?.entry.id, 'a');
    assert.equal(hitRow(row, 350)?.entry.id, 'b');
  });

  test('hits either edge of a bar', () => {
    assert.equal(hitRow(row, 300)?.entry.id, 'b');
    assert.equal(hitRow(row, 400)?.entry.id, 'b');
  });

  test('returns null in the gap between bars', () => {
    assert.equal(hitRow(row, 200), null);
  });

  test('pads a narrow target so it stays clickable', () => {
    // The point event at 700 is 3px wide; without padding it is unhittable.
    assert.equal(hitRow(row, 690, 12)?.entry.id, 'p');
    assert.equal(hitRow(row, 712, 12)?.entry.id, 'p');
    assert.equal(hitRow(row, 740, 12), null);
  });

  test('prefers the nearer item when two padded boxes overlap', () => {
    const tight = packLane([entry('x', 100, 102), entry('y', 130, 132)], view).rows[0];
    assert.equal(hitRow(tight, 104, 24)?.entry.id, 'x');
    assert.equal(hitRow(tight, 128, 24)?.entry.id, 'y');
  });

  test('an empty row hits nothing', () => {
    assert.equal(hitRow([], 50), null);
  });
});
