import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHash, parseHash } from './router.js';

describe('parseHash', () => {
  test('an empty hash is the default view', () => {
    assert.deepEqual(parseHash(''), { route: 'timeline', from: null, to: null, entryId: null });
    assert.deepEqual(parseHash('#'), { route: 'timeline', from: null, to: null, entryId: null });
  });

  test('a timeline window', () => {
    assert.deepEqual(parseHash('#/timeline?from=1500&to=1600'),
      { route: 'timeline', from: 1500, to: 1600, entryId: null });
  });

  test('negative and deep-time years survive the round trip', () => {
    const parsed = parseHash('#/timeline?from=-4540000000&to=-66000000');
    assert.equal(parsed.from, -4540000000);
    assert.equal(parsed.to, -66000000);
  });

  test('an entry route keeps the window alongside it', () => {
    assert.deepEqual(parseHash('#/entry/mughal-empire?from=1400&to=1900'),
      { route: 'entry', from: 1400, to: 1900, entryId: 'mughal-empire' });
  });

  test('an entry route without a window', () => {
    assert.deepEqual(parseHash('#/entry/kabir'),
      { route: 'entry', from: null, to: null, entryId: 'kabir' });
  });

  test('a malformed window is ignored rather than throwing', () => {
    const parsed = parseHash('#/timeline?from=banana&to=1600');
    assert.equal(parsed.from, null);
    assert.equal(parsed.to, 1600);
  });

  test('an unknown route falls back to the timeline', () => {
    assert.equal(parseHash('#/nonsense/thing').route, 'timeline');
  });

  test('an entry id is decoded', () => {
    assert.equal(parseHash('#/entry/guru%20nanak').entryId, 'guru nanak');
  });
});

describe('buildHash', () => {
  test('a timeline window', () => {
    assert.equal(buildHash({ from: 1500, to: 1600 }), '#/timeline?from=1500&to=1600');
  });

  test('rounds fractional years', () => {
    assert.equal(buildHash({ from: 1500.7, to: 1600.2 }), '#/timeline?from=1501&to=1600');
  });

  test('never emits year zero', () => {
    // A view can sit either side of the seam; year 0 is not a year.
    assert.ok(!buildHash({ from: -0.4, to: 5 }).includes('from=0'));
  });

  test('an entry route carries the window', () => {
    assert.equal(buildHash({ from: 1400, to: 1900, entryId: 'mughal-empire' }),
      '#/entry/mughal-empire?from=1400&to=1900');
  });

  test('round-trips through parseHash', () => {
    for (const state of [
      { from: 1500, to: 1600, entryId: null },
      { from: -4540000000, to: 2026, entryId: null },
      { from: -500, to: 500, entryId: 'buddha' },
    ]) {
      const parsed = parseHash(buildHash(state));
      assert.equal(parsed.from, state.from);
      assert.equal(parsed.to, state.to);
      assert.equal(parsed.entryId, state.entryId);
    }
  });
});
