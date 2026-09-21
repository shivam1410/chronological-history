import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  elsewhere, linearView, packStrip, panWindow, sameLane, ticksFor, windowFor,
} from './context.js';

const e = (id, lane, sMin, eMax, imp = 3) => ({
  id, title: id, kind: 'polity', lane, region: lane, alias: '',
  sMin, sMax: sMin, eMin: eMax, eMax, imp, flags: 0,
});

const WORLD = [
  e('vijayanagara', 'india', 1336, 1646, 4),
  e('delhi', 'india', 1206, 1526, 4),
  e('mughal', 'india', 1526, 1857, 5),
  e('ottoman', 'west-asia', 1299, 1922, 5),
  e('black-death', 'europe', 1346, 1353, 4),
  e('aztec', 'americas', 1428, 1521, 4),
  e('ming', 'east-asia', 1368, 1644, 4),
];
const SUBJECT = WORLD[0];

describe('sameLane', () => {
  test('keeps only the entry’s own lane', () => {
    const ids = sameLane(WORLD, SUBJECT).map((x) => x.id);
    assert.deepEqual(ids.sort(), ['delhi', 'mughal']);
  });

  test('never includes the entry itself', () => {
    assert.ok(!sameLane(WORLD, SUBJECT).some((x) => x.id === SUBJECT.id));
  });

  test('limit applies after the lane filter, not before', () => {
    // Sorted globally the west-asia and americas entries outrank delhi, so a
    // limit applied first would return them and then filter them all away.
    assert.equal(sameLane(WORLD, SUBJECT, { limit: 1 }).length, 1);
  });

  test('no entry is not a crash', () => {
    assert.deepEqual(sameLane(WORLD, null), []);
  });
});

describe('elsewhere', () => {
  test('excludes the entry’s own lane', () => {
    const ids = elsewhere(WORLD, SUBJECT).map((x) => x.id).sort();
    assert.deepEqual(ids, ['aztec', 'black-death', 'ming', 'ottoman']);
  });

  test('the two lists never overlap', () => {
    const a = new Set(sameLane(WORLD, SUBJECT).map((x) => x.id));
    const b = elsewhere(WORLD, SUBJECT).map((x) => x.id);
    assert.ok(b.every((id) => !a.has(id)));
  });
});

describe('windowFor', () => {
  test('pads around the entry', () => {
    const w = windowFor(e('x', 'india', 1336, 1646), { pad: 0.5 });
    assert.ok(w.from < 1336 && w.to > 1646);
  });

  test('is sized from the entry, not from a long neighbour', () => {
    // A five-century neighbour must not zoom the entry down to a sliver. The
    // neighbours here run 1206 to 1857; the window should stay close to the
    // entry's own 1336-1646 and let them clip at the edges.
    const w = windowFor(SUBJECT);
    const entrySpan = SUBJECT.eMax - SUBJECT.sMin;
    assert.ok(w.to - w.from < entrySpan * 2.5,
      `window is ${w.to - w.from} years for a ${entrySpan}-year entry`);
    assert.ok(w.to < 1857, `window closed at ${w.to}, swallowed by mughal`);
  });

  test('a single-year entry still gets a window with width', () => {
    const w = windowFor(e('x', 'europe', 1453, 1453));
    assert.ok(w.to > w.from);
  });

  test('skips the missing year zero', () => {
    const w = windowFor(e('x', 'rome', -20, 20));
    assert.notEqual(w.from, 0);
    assert.notEqual(w.to, 0);
  });
});

describe('panWindow', () => {
  test('later moves forward, earlier moves back', () => {
    const w = { from: 1200, to: 1700 };
    assert.ok(panWindow(w, 0.5).from > 1200);
    assert.ok(panWindow(w, -0.5).from < 1200);
  });

  test('keeps the width it was given', () => {
    const w = { from: 1200, to: 1700 };
    const moved = panWindow(w, 0.5);
    assert.equal(moved.to - moved.from, w.to - w.from);
  });

  test('never lands on year zero', () => {
    for (let i = -40; i <= 40; i++) {
      const w = panWindow({ from: -50, to: -10 }, i / 10);
      assert.notEqual(w.from, 0);
      assert.notEqual(w.to, 0);
    }
  });
});

describe('linearView', () => {
  test('projects the ends to the ends', () => {
    const v = linearView(1200, 1700, 500);
    assert.equal(Math.round(v.project(1200)), 0);
    assert.equal(Math.round(v.project(1700)), 500);
  });

  test('is linear, unlike the main scale', () => {
    const v = linearView(1200, 1700, 500);
    assert.equal(Math.round(v.project(1450)), 250);
  });

  test('crosses the year-zero seam without a gap', () => {
    // 1 BCE and 1 CE are adjacent; a naive subtraction leaves a year of space.
    const v = linearView(-2, 2, 30);
    assert.equal(Math.round(v.project(2) - v.project(-2)), 30);
    assert.equal(Math.round(v.project(1) - v.project(-1)), 10);
  });

  test('exposes what packLane needs', () => {
    const v = linearView(1200, 1700, 500);
    for (const key of ['from', 'to', 'project']) assert.ok(key in v);
  });
});

describe('ticksFor', () => {
  test('gives round years across the window', () => {
    const t = ticksFor(1200, 1700);
    assert.ok(t.length >= 3);
    assert.ok(t.every((y) => y % 100 === 0), `not round: ${t}`);
  });

  test('every tick lies inside the window', () => {
    const t = ticksFor(1336, 1646);
    assert.ok(t.every((y) => y >= 1336 && y <= 1646));
  });

  test('no tick is year zero', () => {
    assert.ok(!ticksFor(-200, 200).includes(0));
  });

  test('a one-year window does not hang', () => {
    assert.ok(Array.isArray(ticksFor(1453, 1454)));
  });
});

describe('ticksFor density', () => {
  test('honours the count it was asked for', () => {
    // niceStep rounds down, so an unthinned 1400-year window yields eight.
    assert.ok(ticksFor(-1401, -1, { count: 5 }).length <= 6);
  });

  test('thins without losing the ends of the range', () => {
    const t = ticksFor(-1401, -1, { count: 5 });
    assert.ok(t.every((y) => y >= -1401 && y <= -1));
  });

  test('still returns ticks for a narrow window', () => {
    assert.ok(ticksFor(1336, 1646, { count: 5 }).length >= 2);
  });

  test('stays evenly spaced after thinning', () => {
    const t = ticksFor(-1401, -1, { count: 5 });
    const gaps = t.slice(1).map((y, i) => y - t[i]);
    assert.equal(new Set(gaps).size, 1, `uneven ladder: ${t}`);
  });
});

describe('packStrip keeps the card’s own entry in its own strip', () => {
  // Akbar's card, as it shipped: five contemporaries in the North India lane,
  // all overlapping each other and him, so every one of them takes a row.
  // packLane sorts by position, so being first in the array bought nothing
  // and the fourth row filled before Akbar's turn came.
  const AKBAR = e('akbar', 'north-india', 1542, 1605, 5);
  const CROWD = [
    e('vijayanagara', 'north-india', 1336, 1646, 4),
    e('surdas', 'north-india', 1478, 1583, 3),
    e('tulsidas', 'north-india', 1497, 1623, 4),
    e('mirabai', 'north-india', 1498, 1557, 3),
    e('kabir-collections', 'north-india', 1570, 1604, 3),
    e('adi-granth', 'north-india', 1604, 1604, 3),
  ];
  const view = linearView(1520, 1620, 100);
  const opts = { maxRows: 4, minWidthPx: 2, gapPx: 0.8 };

  const ids = (packed) => packed.rows.flat().map((item) => item.entry.id);

  test('the entry is present even when neighbours would fill every row', () => {
    assert.ok(ids(packStrip(AKBAR, CROWD, view, opts)).includes('akbar'));
  });

  test('the entry is on the first row, alone', () => {
    const packed = packStrip(AKBAR, CROWD, view, opts);
    assert.deepEqual(packed.rows[0].map((item) => item.entry.id), ['akbar']);
  });

  test('neighbours share the rows that are left, and no more', () => {
    const packed = packStrip(AKBAR, CROWD, view, opts);
    assert.ok(packed.rows.length <= opts.maxRows,
      `${packed.rows.length} rows exceeds the cap`);
  });

  test('neighbours that do not fit are counted, not dropped silently', () => {
    const packed = packStrip(AKBAR, CROWD, view, opts);
    const shown = ids(packed).length;
    assert.equal(shown + packed.hidden, CROWD.length + 1);
  });

  test('a lane with room keeps every neighbour', () => {
    // Inside the window: cull drops anything outside it before packing, and
    // what is culled is not overflow.
    const quiet = [e('before', 'north-india', 1525, 1538, 3)];
    const packed = packStrip(AKBAR, quiet, view, opts);
    assert.equal(packed.hidden, 0);
    assert.deepEqual(ids(packed).sort(), ['akbar', 'before']);
  });

  test('no neighbours at all still yields the entry', () => {
    assert.deepEqual(ids(packStrip(AKBAR, [], view, opts)), ['akbar']);
  });
});
