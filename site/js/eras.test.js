import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERAS, FULL_RANGE } from './eras.js';
import { ORIGIN_YEAR, createView, presentYear } from './timescale.js';

describe('era shortcuts', () => {
  test('there are seven, covering deep time through the present', () => {
    assert.equal(ERAS.length, 7);
    assert.equal(ERAS[0].from, ORIGIN_YEAR);
    assert.equal(ERAS.at(-1).to, presentYear());
  });

  test('each era is a forward window inside the domain', () => {
    for (const era of ERAS) {
      assert.ok(era.from < era.to, `${era.id} is reversed`);
      assert.ok(era.from >= ORIGIN_YEAR, `${era.id} starts before the origin`);
      assert.ok(era.to <= presentYear(), `${era.id} ends after the present`);
      assert.notEqual(era.from, 0, `${era.id} starts on the non-existent year 0`);
      assert.notEqual(era.to, 0, `${era.id} ends on the non-existent year 0`);
    }
  });

  test('eras run in chronological order', () => {
    for (let i = 1; i < ERAS.length; i++) {
      assert.ok(ERAS[i].from > ERAS[i - 1].from,
        `${ERAS[i].id} does not start after ${ERAS[i - 1].id}`);
    }
  });

  test('ids and labels are unique', () => {
    assert.equal(new Set(ERAS.map((e) => e.id)).size, ERAS.length);
    assert.equal(new Set(ERAS.map((e) => e.label)).size, ERAS.length);
  });

  test('every era survives a round trip through createView unchanged', () => {
    // A window the view would clamp or collapse is not a usable shortcut.
    for (const era of ERAS) {
      const view = createView(era.from, era.to, 1000);
      assert.equal(view.from, era.from, `${era.id} from was clamped`);
      assert.equal(view.to, era.to, `${era.id} to was clamped`);
    }
  });

  test('each era occupies a visible slice of the full axis', () => {
    const full = createView(FULL_RANGE.from, FULL_RANGE.to, 1000);
    for (const era of ERAS) {
      const width = full.project(era.to) - full.project(era.from);
      assert.ok(width >= 8, `${era.id} is only ${width.toFixed(1)}px of the full axis`);
    }
  });
});
