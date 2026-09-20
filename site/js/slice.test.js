import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { activeIn, groupByLane, overlapping, positionIn } from './slice.js';

const e = (id, sMin, eMax, extra = {}) => ({
  id, title: id, kind: 'polity', lane: 'india', region: 'north-india',
  alias: '', sMin, sMax: sMin, eMin: eMax, eMax, imp: 3, flags: 0, ...extra,
});

const ENTRIES = [
  e('mughal', 1526, 1857, { imp: 5 }),
  e('tulsidas', 1511, 1623, { kind: 'person', imp: 5 }),
  e('sur', 1540, 1556, { imp: 3 }),
  e('amasya', 1555, 1555, { lane: 'west-asia', imp: 3 }),
  e('augsburg', 1555, 1555, { lane: 'europe', imp: 4 }),
  e('safavid', 1501, 1736, { lane: 'west-asia', imp: 4 }),
  e('ming', 1368, 1644, { lane: 'east-asia', imp: 4 }),
  e('later', 1900, 2000, { lane: 'europe' }),
  e('earlier', 1200, 1300, { lane: 'europe' }),
];

describe('activeIn', () => {
  const ids = (year) => activeIn(ENTRIES, year).map((x) => x.entry.id);

  test('includes entries whose span contains the year', () => {
    assert.ok(ids(1555).includes('mughal'));
    assert.ok(ids(1555).includes('tulsidas'));
  });

  test('excludes entries that ended before it', () => {
    assert.ok(!ids(1555).includes('earlier'));
  });

  test('excludes entries that begin after it', () => {
    assert.ok(!ids(1555).includes('later'));
  });

  test('includes both edges of a span', () => {
    assert.ok(ids(1526).includes('mughal'));
    assert.ok(ids(1857).includes('mughal'));
    assert.ok(!ids(1858).includes('mughal'));
    assert.ok(!ids(1525).includes('mughal'));
  });

  test('includes a single-year event on its own year', () => {
    assert.ok(ids(1555).includes('amasya'));
    assert.ok(!ids(1554).includes('amasya'));
  });

  test('marks entries that start or end in the queried year', () => {
    const hits = activeIn(ENTRIES, 1526);
    assert.equal(hits.find((h) => h.entry.id === 'mughal').boundary, true);
    assert.equal(hits.find((h) => h.entry.id === 'tulsidas').boundary, false);
  });

  test('boundary entries sort ahead of ones merely passing through', () => {
    const order = ids(1555);
    // amasya and augsburg begin and end in 1555; the empires do not.
    assert.ok(order.indexOf('amasya') < order.indexOf('mughal'));
  });

  test('importance breaks ties, then earlier start', () => {
    const order = ids(1600);
    assert.ok(order.indexOf('mughal') < order.indexOf('ming'),
      `imp 5 should precede imp 4: ${order.join(',')}`);
  });

  test('works across the BCE/CE seam without an off-by-one', () => {
    const spanning = [e('rome', -27, 476)];
    assert.equal(activeIn(spanning, -1).length, 1);
    assert.equal(activeIn(spanning, 1).length, 1);
    assert.equal(activeIn(spanning, -28).length, 0);
  });

  test('year zero is rejected, because there is no year zero', () => {
    assert.throws(() => activeIn(ENTRIES, 0), /no year zero/);
  });

  test('a year with nothing active returns an empty list', () => {
    assert.deepEqual(activeIn(ENTRIES, -5000), []);
  });
});

describe('groupByLane', () => {
  const order = ['india', 'east-asia', 'west-asia', 'europe'];

  test('groups in the given lane order', () => {
    const groups = groupByLane(activeIn(ENTRIES, 1555), order);
    assert.deepEqual(groups.map((g) => g.lane), ['india', 'east-asia', 'west-asia', 'europe']);
  });

  test('omits lanes with nothing active', () => {
    const groups = groupByLane(activeIn(ENTRIES, 1526), order);
    assert.ok(!groups.some((g) => g.lane === 'europe'));
  });

  test('keeps every entry exactly once', () => {
    const hits = activeIn(ENTRIES, 1555);
    const grouped = groupByLane(hits, order).flatMap((g) => g.hits);
    assert.equal(grouped.length, hits.length);
    assert.equal(new Set(grouped.map((h) => h.entry.id)).size, hits.length);
  });

  test('an unknown lane still appears rather than vanishing', () => {
    const odd = [e('x', 1500, 1600, { lane: 'atlantis' })];
    const groups = groupByLane(activeIn(odd, 1555), order);
    assert.equal(groups.flatMap((g) => g.hits).length, 1);
  });
});

describe('positionIn', () => {
  test('elapsed position within a span', () => {
    assert.equal(positionIn(e('m', 1526, 1857), 1555), 'year 29 of 331');
  });

  test('age for a person', () => {
    assert.equal(positionIn(e('t', 1511, 1623, { kind: 'person' }), 1555), 'age 44');
  });

  test('a single-year event says only that it is this year', () => {
    assert.equal(positionIn(e('a', 1555, 1555), 1555), 'this year');
  });

  test('the first year of a span is year 0, not year 1', () => {
    assert.equal(positionIn(e('m', 1526, 1857), 1526), 'begins');
  });

  test('the final year says so', () => {
    assert.equal(positionIn(e('m', 1526, 1857), 1857), 'ends');
  });

  test('counts elapsed years across the seam', () => {
    assert.equal(positionIn(e('r', -27, 476), 1), 'year 27 of 502');
  });
});

describe('positionIn on imprecise and very long spans', () => {
  test('a deep-time span does not count individual years', () => {
    // "year 58999605 of 59000076" is technically true and useless.
    const orogeny = e('h', -58_998_051, 2026);
    const where = positionIn(orogeny, 1555);
    assert.ok(!/year \d/.test(where), `got ${where}`);
  });

  test('a deep-time span says how far in, in readable units', () => {
    assert.match(positionIn(e('h', -58_998_051, 2026), 1555), /million years/);
  });

  test('a bracketed birth gives an age range, not false precision', () => {
    // Tulsidas was born 1497-1532, so in 1555 he was 23 to 58 - not 58.
    const tulsidas = e('t', 1497, 1623, { kind: 'person', sMax: 1532 });
    assert.equal(positionIn(tulsidas, 1555), 'age 23–58');
  });

  test('a precise birth still gives one age', () => {
    assert.equal(positionIn(e('a', 1542, 1605, { kind: 'person', sMax: 1542 }), 1555),
      'age 13');
  });

  test('a bracketed span within recorded history still counts years', () => {
    const entry = e('m', 1526, 1857, { sMax: 1526 });
    assert.equal(positionIn(entry, 1555), 'year 29 of 331');
  });
});

describe('age when the year falls inside a bracketed birth', () => {
  test('a negative lower bound is not reported as a negative age', () => {
    // Laozi: born 600-400 BCE. In 500 BCE he is either 100 or not yet born,
    // so "age -100-100" is nonsense.
    const laozi = e('l', -600, -350, { kind: 'person', sMax: -400 });
    const where = positionIn(laozi, -500);
    assert.ok(!where.includes('-1'), `got ${where}`);
    assert.equal(where, 'age up to 100');
  });

  test('the Buddha case', () => {
    const buddha = e('b', -563, -400, { kind: 'person', sMax: -480 });
    assert.equal(positionIn(buddha, -500), 'age up to 63');
  });

  test('a bracket entirely before the year still gives a range', () => {
    const heraclitus = e('h', -540, -475, { kind: 'person', sMax: -535 });
    assert.equal(positionIn(heraclitus, -500), 'age 35–40');
  });

  test('a precise birth is unaffected', () => {
    assert.equal(positionIn(e('a', 1542, 1605, { kind: 'person', sMax: 1542 }), 1555),
      'age 13');
  });
});

describe('overlapping', () => {
  const span = (id, sMin, eMax, imp = 3) => e(id, sMin, eMax, { imp });

  test('finds entries whose span crosses this one', () => {
    const all = [span('a', 1500, 1600), span('b', 1550, 1560), span('c', 1700, 1800)];
    const ids = overlapping(all, all[0]).map((x) => x.id);
    assert.deepEqual(ids, ['b']);
  });

  test('never includes the entry itself', () => {
    const all = [span('a', 1500, 1600), span('b', 1500, 1600)];
    assert.ok(!overlapping(all, all[0]).some((x) => x.id === 'a'));
  });

  test('a single year inside a long span counts as overlapping', () => {
    const all = [span('dynasty', 1500, 1900), span('battle', 1600, 1600)];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id), ['battle']);
    assert.deepEqual(overlapping(all, all[1]).map((x) => x.id), ['dynasty']);
  });

  test('touching at a single year still overlaps', () => {
    const all = [span('a', 1500, 1600), span('b', 1600, 1700)];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id), ['b']);
  });

  test('a gap of one year does not overlap', () => {
    const all = [span('a', 1500, 1599), span('b', 1600, 1700)];
    assert.deepEqual(overlapping(all, all[0]), []);
  });

  test('spans crossing the year-zero seam overlap correctly', () => {
    // No year 0: -1 is 1 BCE and 1 is 1 CE, so these are adjacent years.
    const all = [span('bce', -50, -1), span('ce', 1, 50)];
    assert.deepEqual(overlapping(all, all[0]), []);
    const straddling = [span('bce', -50, -1), span('wide', -10, 10)];
    assert.deepEqual(overlapping(straddling, straddling[0]).map((x) => x.id), ['wide']);
  });

  test('leads with importance, then with the nearest start', () => {
    const all = [
      span('subject', 1500, 1600),
      span('minor-near', 1500, 1510, 1),
      span('major-far', 1590, 1600, 5),
    ];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id),
      ['major-far', 'minor-near']);
  });

  test('limit caps the list', () => {
    const all = [span('s', 1500, 1600), span('a', 1500, 1600), span('b', 1500, 1600)];
    assert.equal(overlapping(all, all[0], { limit: 1 }).length, 1);
  });

  test('no entry means no contemporaries, not a crash', () => {
    assert.deepEqual(overlapping([span('a', 1, 2)], null), []);
  });
});

describe('overlapping and background eras', () => {
  const span = (id, sMin, eMax, imp = 3) => e(id, sMin, eMax, { imp });

  test('an era vastly longer than the subject is not a contemporary', () => {
    // The Holocene overlaps almost everything; listing it tells a reader
    // nothing and leaves it permanently lit on the chart.
    const all = [span('zhou', -1046, -256), span('holocene', -9750, 2026)];
    assert.deepEqual(overlapping(all, all[0]), []);
  });

  test('but a dynasty containing a single-year event still counts', () => {
    // The opposite case: context, not background.
    const all = [span('battle', 1600, 1600), span('dynasty', 1500, 1900)];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id), ['dynasty']);
  });

  test('an entry of comparable length is kept', () => {
    const all = [span('zhou', -1046, -256), span('scythians', -900, -300)];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id), ['scythians']);
  });

  test('the subject being long does not exclude everything short', () => {
    const all = [span('zhou', -1046, -256), span('ashoka', -304, -232)];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id), ['ashoka']);
  });

  test('two background eras are still contemporaries of each other', () => {
    const all = [span('pleistocene', -2580000, -9750), span('holocene', -9750, 2026)];
    assert.deepEqual(overlapping(all, all[0]).map((x) => x.id), ['holocene']);
  });
});
