import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { astro, historical, duration, formatYear, formatDuration, formatAge } from './format.js';

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
