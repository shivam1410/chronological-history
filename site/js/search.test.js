import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search } from './search.js';

const e = (id, title, extra = {}) => ({
  id, title, kind: 'person', lane: 'india', region: 'north-india',
  alias: '', sMin: 1400, sMax: 1400, eMin: 1500, eMax: 1500,
  imp: 3, bucket: 'ce-1001-1499', flags: 0, ...extra,
});

const ENTRIES = [
  e('kabir', 'Kabir', { alias: 'Kabir Das|Bhagat Kabir', imp: 5 }),
  e('tulsidas', 'Tulsidas', { alias: 'Goswami Tulsidas', imp: 5 }),
  e('rigveda', 'Composition of the Rigveda', { alias: 'Rig Veda|Ṛgveda', imp: 5 }),
  e('mughal-empire', 'Mughal Empire', { imp: 5, sMin: 1526 }),
  e('mali-empire', 'Mali Empire', { imp: 3, sMin: 1235 }),
  e('maurya-empire', 'Maurya Empire', { imp: 5, sMin: -322 }),
  e('akbar', 'Akbar', { imp: 5 }),
  e('ashoka', 'Ashoka', { imp: 5 }),
];

const index = buildIndex(ENTRIES);
const ids = (q, opts) => search(index, q, opts).map((r) => r.entry.id);

describe('buildIndex', () => {
  test('indexes every entry', () => {
    assert.equal(index.size, ENTRIES.length);
  });

  test('exposes a sorted token list for prefix lookup', () => {
    assert.ok(index.tokens.length > 0);
    const sorted = [...index.tokens].sort();
    assert.deepEqual(index.tokens, sorted);
  });

  test('tokens are unique', () => {
    assert.equal(new Set(index.tokens).size, index.tokens.length);
  });
});

describe('search', () => {
  test('an empty query returns nothing', () => {
    assert.deepEqual(ids(''), []);
    assert.deepEqual(ids('   '), []);
  });

  test('finds an exact title', () => {
    assert.equal(ids('Kabir')[0], 'kabir');
  });

  test('is case insensitive', () => {
    assert.equal(ids('kABIR')[0], 'kabir');
  });

  test('matches a prefix', () => {
    assert.equal(ids('tul')[0], 'tulsidas');
    assert.equal(ids('ashok')[0], 'ashoka');
  });

  test('matches an alias', () => {
    assert.equal(ids('Kabir Das')[0], 'kabir');
    assert.equal(ids('Rig Veda')[0], 'rigveda');
  });

  test('folds diacritics so an unaccented query still matches', () => {
    assert.equal(ids('rgveda')[0], 'rigveda');
  });

  test('matches a word inside a title, not only the first', () => {
    assert.ok(ids('rigveda').includes('rigveda'));
    assert.ok(ids('empire').length >= 3);
  });

  test('an exact title beats a merely-prefixed one', () => {
    const results = ids('mughal');
    assert.equal(results[0], 'mughal-empire');
  });

  test('multi-word queries require every word', () => {
    assert.deepEqual(ids('mughal empire'), ['mughal-empire']);
    assert.deepEqual(ids('mali empire'), ['mali-empire']);
  });

  test('the last word of a query is treated as a prefix', () => {
    assert.deepEqual(ids('mughal emp'), ['mughal-empire']);
  });

  test('importance breaks ties between equal matches', () => {
    const results = ids('empire');
    const rank = (id) => results.indexOf(id);
    assert.ok(rank('mughal-empire') < rank('mali-empire'),
      `mughal (imp 5) should outrank mali (imp 3): ${results.join(',')}`);
  });

  test('no match returns an empty list rather than throwing', () => {
    assert.deepEqual(ids('zzzznothing'), []);
  });

  test('respects the result limit', () => {
    assert.equal(ids('a', { limit: 2 }).length <= 2, true);
  });

  test('results are unique', () => {
    const results = ids('kabir');
    assert.equal(new Set(results).size, results.length);
  });

  test('punctuation in the query is ignored', () => {
    assert.equal(ids('kabir!')[0], 'kabir');
  });

  test('every result carries its entry and a score', () => {
    for (const hit of search(index, 'empire')) {
      assert.ok(hit.entry.id);
      assert.equal(typeof hit.score, 'number');
    }
  });
});
