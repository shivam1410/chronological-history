import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseYearInput } from './controls.js';

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
