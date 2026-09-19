import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  astro, historical, duration, elapsed, formatYear, formatDuration,
  formatAge, roundYear, toAstroYear, fromAstroYear,
} from './format.js';

describe('year numbering', () => {
  test('astro shifts BCE up by one', () => {
    assert.equal(astro(-1), 0);
    assert.equal(astro(-500), -499);
  });

  test('astro leaves CE untouched', () => {
    assert.equal(astro(1), 1);
    assert.equal(astro(1526), 1526);
  });

  test('historical inverts astro', () => {
    for (const y of [-4539998051, -65998051, -10051, -500, -1, 1, 1526, 2026]) {
      assert.equal(historical(astro(y)), y);
    }
  });

  test('year zero throws', () => {
    assert.throws(() => astro(0), /no year zero/);
  });

  test('duration crosses the era boundary without an off-by-one', () => {
    assert.equal(duration(-1, 1), 1);
    assert.equal(duration(1526, 1857), 331);
    assert.equal(duration(-500, -1), 499);
  });
});

describe('formatYear', () => {
  const cases = [
    [-4539998051, '4.54 Ga'],
    [-65998051, '66 Ma'],
    [-10051, '12 ka'],
    [-500, '500 BCE'],
    [-1, '1 BCE'],
    [1, '1 CE'],
    [1526, '1526'],
    [2026, '2026'],
  ];
  for (const [year, expected] of cases) {
    test(`${year} -> ${expected}`, () => assert.equal(formatYear(year), expected));
  }
});

describe('formatDuration', () => {
  test('years', () => assert.equal(formatDuration(331), '331 years'));
  test('a single year', () => assert.equal(formatDuration(1), '1 year'));
  test('thousands', () => assert.equal(formatDuration(12000), '12,000 years'));
  test('millions', () => assert.equal(formatDuration(165000000), '165 million years'));
  test('billions', () => assert.equal(formatDuration(4540000000), '4.54 billion years'));
});

describe('formatAge', () => {
  test('age within a precise lifespan', () => {
    assert.equal(formatAge(1542, 1555), 'age 13');
  });
  test('age across the era boundary', () => {
    assert.equal(formatAge(-5, 5), 'age 9');
  });
});

describe('roundYear', () => {
  test('rounds to a whole year', () => {
    assert.equal(roundYear(1526.4), 1526);
    assert.equal(roundYear(-500.6), -501);
  });

  test('never lands on the year that does not exist', () => {
    // A view can sit at a fraction of a year either side of the seam; plain
    // Math.round gives 0 there, and formatYear rejects it.
    assert.equal(roundYear(0.3), 1);
    assert.equal(roundYear(0.0047), 1);
    assert.equal(roundYear(-0.3), -1);
    assert.equal(roundYear(0), 1);
  });

  test('a rounded year is always formattable', () => {
    for (let y = -3; y <= 3; y += 0.1) {
      assert.doesNotThrow(() => formatYear(roundYear(y)), `failed at ${y}`);
    }
  });
});

describe('elapsed', () => {
  test('matches duration for whole years', () => {
    assert.equal(elapsed(1526, 1857), 331);
    assert.equal(elapsed(-1, 1), 1);
    assert.equal(elapsed(-500, 200), 699);
  });

  test('tolerates fractional years, which duration cannot', () => {
    // A view sits at fractional years all the time; astro() throws on 0, so
    // UI heuristics need a conversion that stays continuous through the seam.
    assert.doesNotThrow(() => elapsed(-0.4, 0.4));
    assert.ok(Math.abs(elapsed(1500.5, 1600.5) - 100) < 1e-9);
  });

  test('is the astro difference, not raw subtraction', () => {
    // Raw subtraction would say 701 here, counting the year that is not a year.
    assert.notEqual(elapsed(-500, 200), 200 - -500);
  });
});

describe('toAstroYear / fromAstroYear', () => {
  test('round-trip whole years', () => {
    for (const y of [-500, -1, 1, 1526]) {
      assert.equal(fromAstroYear(toAstroYear(y)), y);
    }
  });

  test('do not throw on zero, unlike astro/historical', () => {
    assert.doesNotThrow(() => toAstroYear(0));
    assert.throws(() => astro(0));
  });
});
