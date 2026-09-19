import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseYearInput } from './controls.js';
import { formatYear } from './format.js';

describe('parseYearInput', () => {
  test('plain years', () => {
    assert.equal(parseYearInput('1526'), 1526);
    assert.equal(parseYearInput(' 1526 '), 1526);
  });

  test('negative years are BCE', () => {
    assert.equal(parseYearInput('-500'), -500);
  });

  test('BCE and BC suffixes', () => {
    assert.equal(parseYearInput('500 BCE'), -500);
    assert.equal(parseYearInput('500 bc'), -500);
    assert.equal(parseYearInput('500BCE'), -500);
  });

  test('CE is positive', () => {
    assert.equal(parseYearInput('1526 CE'), 1526);
    assert.equal(parseYearInput('200 ce'), 200);
  });

  test('year zero becomes 1, because there is no year zero', () => {
    assert.equal(parseYearInput('0'), 1);
  });

  test('fractions are truncated to whole years', () => {
    assert.equal(parseYearInput('1526.9'), 1526);
  });

  test('empty and unparseable input is null, not a guess', () => {
    for (const bad of ['', '   ', 'banana', '-', null, undefined]) {
      assert.equal(parseYearInput(bad), null, `expected null for ${bad}`);
    }
  });

  test('a BCE year written negative stays negative, not doubly flipped', () => {
    assert.equal(parseYearInput('-500 BCE'), -500);
  });
});

describe('parseYearInput round-trips what the field displays', () => {
  // The range inputs are filled from formatYear(), which emits "4.54 Ga" and
  // "66 Ma". Stripping non-digits turned those into years 4 and 66 CE.
  test('deep-time suffixes', () => {
    assert.equal(parseYearInput('66 Ma'), -65998051);
    assert.equal(parseYearInput('12 ka'), -10051);
    assert.equal(parseYearInput('4.54 Ga'), -4539998051);
  });

  test('spacing and case of the suffix', () => {
    assert.equal(parseYearInput('66Ma'), parseYearInput('66 Ma'));
    assert.equal(parseYearInput('  12 ka  '), parseYearInput('12 ka'));
  });

  test('round-trips every value the field can show', () => {
    for (const year of [-4539998051, -65998051, -10051, -500, -1, 1, 1526, 2026]) {
      const shown = formatYear(year);
      const parsed = parseYearInput(shown);
      assert.equal(formatYear(parsed), shown,
        `"${shown}" parsed to ${parsed}, which formats as "${formatYear(parsed)}"`);
    }
  });

  test('a bare number is still a year, not a magnitude', () => {
    assert.equal(parseYearInput('66'), 66);
    assert.equal(parseYearInput('4.54'), 4);
  });
});
