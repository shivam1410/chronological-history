import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { clipToWords, wrapText } from './wrap.js';

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

describe('clipToWords', () => {
  const clip = (text, width) => clipToWords(text, width, measure);

  test('a title that fits is returned whole, with no ellipsis', () => {
    assert.equal(clip('Ming', 100), 'Ming');
  });

  test('cuts at a space rather than mid-word', () => {
    // "Mughal Empire" is 130px; 90px holds "Mughal" plus the ellipsis.
    assert.equal(clip('Mughal Empire', 90), 'Mughal…');
  });

  test('cuts at an em dash', () => {
    const out = clip('Himalayan Orogeny — India collides with Eurasia', 190);
    assert.equal(out, 'Himalayan Orogeny…');
  });

  test('cuts at a hyphen', () => {
    assert.equal(clip('Austro-Hungarian', 90), 'Austro…');
  });

  test('never ends on the separator it cut at', () => {
    for (const w of [60, 80, 100, 120, 140]) {
      const out = clip('Sun Yat-sen – the Republic', w);
      assert.ok(!/[\s–—-]…$/.test(out), `trailing separator in "${out}"`);
    }
  });

  test('shows nothing when not even the first word fits', () => {
    assert.equal(clip('Constantinople', 40), '');
  });

  test('what it returns always fits the width it was given', () => {
    const titles = ['Mughal Empire', 'Himalayan Orogeny — India collides with Eurasia',
      'Compilation of the Adi Granth', 'ENIAC and the first electronic computers'];
    for (const t of titles) {
      for (const w of [30, 60, 90, 150, 240]) {
        const out = clip(t, w);
        assert.ok(measure(out) <= w, `"${out}" (${measure(out)}px) exceeds ${w}px`);
      }
    }
  });

  test('empty and missing input are not a crash', () => {
    assert.equal(clip('', 100), '');
    assert.equal(clip(null, 100), '');
  });
});

describe('clipToWords and bare articles', () => {
  const clip = (text, width) => clipToWords(text, width, measure);

  test('does not offer an article as the whole label', () => {
    // "The Austronesian expansion" cut to "The…" tells a reader nothing.
    assert.equal(clip('The Austronesian expansion', 55), '');
  });

  test('but keeps an article when a real word comes with it', () => {
    assert.equal(clip('The Grand Canal', 110), 'The Grand…');
  });

  test('an article as the entire title is still returned whole', () => {
    assert.equal(clip('The', 100), 'The');
  });
});
