import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText } from './wrap.js';

/** A stand-in for canvas text metrics: every character is 10px wide. */
const measure = (s) => s.length * 10;

const wrap = (text, width, lines = 3) => wrapText(text, width, lines, measure);

describe('wrapText', () => {
  test('a label that fits stays on one line', () => {
    assert.deepEqual(wrap('Africa', 100), ['Africa']);
  });

  test('breaks on spaces rather than cutting the name off', () => {
    assert.deepEqual(wrap('Indian Subcontinent', 130), ['Indian', 'Subcontinent']);
  });

  test('fills each line before starting the next', () => {
    assert.deepEqual(wrap('a b c d e', 50), ['a b c', 'd e']);
  });

  test('stops at the line cap', () => {
    const lines = wrap('one two three four five six', 50, 2);
    assert.equal(lines.length, 2);
  });

  test('the line in progress survives the cap', () => {
    // Regression: committing the cap check before pushing the pending line
    // silently dropped the last words instead of showing them.
    assert.deepEqual(wrap('alpha beta gamma', 60, 2), ['alpha', 'beta']);
  });

  test('a word too wide for the column is cut, and marked as cut', () => {
    const [line] = wrap('Mediterranean', 60);
    assert.ok(line.endsWith('…'), `expected an ellipsis, got ${line}`);
    assert.ok(measure(line) <= 60, `${line} is still too wide`);
  });

  test('only the over-wide word is cut, not its neighbours', () => {
    const lines = wrap('of Mediterranean', 60);
    assert.equal(lines[0], 'of');
    assert.ok(lines[1].endsWith('…'));
  });

  test('every returned line fits the column', () => {
    const labels = [
      'Earth & Life', 'Indian Subcontinent', 'East & Southeast Asia',
      'Central Asia & the Steppe', 'West Asia & Persia',
      'Europe & Mediterranean', 'Science & Discovery', 'Philosophy & Ideas',
    ];
    for (const label of labels) {
      for (const line of wrap(label, 90)) {
        assert.ok(measure(line) <= 90, `"${line}" overflows for "${label}"`);
      }
    }
  });

  test('always returns at least one line, even for nothing', () => {
    assert.deepEqual(wrap('', 100), ['']);
    assert.deepEqual(wrap('   ', 100), ['']);
    assert.deepEqual(wrap(null, 100), ['']);
  });

  test('collapses runs of whitespace', () => {
    assert.deepEqual(wrap('East   &  Asia', 200), ['East & Asia']);
  });
});
