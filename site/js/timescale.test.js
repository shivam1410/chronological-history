import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHORS, ORIGIN_YEAR, presentYear,
  yearToUnit, unitToYear, createView,
} from './timescale.js';
import { astro } from './format.js';

describe('yearToUnit / unitToYear', () => {
  test('the origin is 0 and the present is 1', () => {
    assert.equal(yearToUnit(ORIGIN_YEAR), 0);
    assert.equal(yearToUnit(presentYear()), 1);
  });

  test('every anchor lands on its declared unit', () => {
    for (const [year, unit] of ANCHORS) {
      assert.ok(Math.abs(yearToUnit(year) - unit) < 1e-9,
        `anchor ${year} -> ${yearToUnit(year)}, expected ${unit}`);
    }
  });

  test('round-trips to under 1e-4 years', () => {
    const probes = [ORIGIN_YEAR, -66000000, -2580000, -11700, -3000, -500, 1, 1555, 1950, 2020];
    for (const y of probes) {
      assert.ok(Math.abs(unitToYear(yearToUnit(y)) - y) < 1e-4,
        `${y} round-tripped to ${unitToYear(yearToUnit(y))}`);
    }
  });

  test('is strictly monotonic across the whole domain', () => {
    const years = [];
    for (let i = 0; i <= 2000; i++) years.push(Math.round(ORIGIN_YEAR * (1 - i / 2000)));
    for (let y = -5000; y <= 2020; y += 1) years.push(y);
    const sorted = [...new Set(years)].filter((y) => y !== 0).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(yearToUnit(sorted[i]) > yearToUnit(sorted[i - 1]),
        `not monotonic between ${sorted[i - 1]} and ${sorted[i]}`);
    }
  });

  test('allocates the budget the spec declares', () => {
    const pct = (a, b) => (yearToUnit(b) - yearToUnit(a)) * 100;
    assert.ok(Math.abs(pct(-3000, presentYear()) - 48) < 0.5, 'recorded history ~48%');
    assert.ok(Math.abs(pct(-2580000, -11700) - 12) < 0.5, 'Pleistocene ~12%');
    assert.ok(Math.abs(pct(ORIGIN_YEAR, -66000000) - 20) < 0.5, 'deep time to K-Pg ~20%');
  });

  test('clamps outside the domain rather than returning NaN', () => {
    assert.equal(yearToUnit(ORIGIN_YEAR - 1e9), 0);
    assert.equal(yearToUnit(presentYear() + 500), 1);
  });
});

describe('createView', () => {
  test('projects the window edges to 0 and the full width', () => {
    const view = createView(1500, 1600, 1000);
    assert.ok(Math.abs(view.project(1500) - 0) < 1e-6);
    assert.ok(Math.abs(view.project(1600) - 1000) < 1e-6);
  });

  test('is near-linear inside a narrow window', () => {
    // sp-space is logarithmic, so a window's midpoint does not land exactly at
    // mid-width. The contract is that the curvature stays under ~2% of width,
    // which is imperceptible; anything larger would visibly warp a century.
    const view = createView(1500, 1600, 1000);
    assert.ok(Math.abs(view.project(1550) - 500) < 20,
      `1550 projected to ${view.project(1550)}`);
  });

  test('project and unproject are inverses', () => {
    const view = createView(-3000, 2020, 1400);
    for (const y of [-3000, -1500, -500, 1, 1000, 1555, 2020]) {
      assert.ok(Math.abs(view.unproject(view.project(y)) - y) < 1e-3);
    }
  });

  test('zoomAbout keeps the year under the cursor fixed', () => {
    const view = createView(-4540000000, 2020, 1400);
    for (const px of [100, 700, 1300]) {
      const anchorYear = view.unproject(px);
      const zoomed = view.zoomAbout(px, 0.25);
      assert.ok(Math.abs(zoomed.project(anchorYear) - px) < 0.5,
        `cursor drifted at px=${px}`);
    }
  });

  test('zoom narrows the window', () => {
    const view = createView(-4540000000, 2020, 1400);
    const zoomed = view.zoomAbout(700, 0.5);
    assert.ok(zoomed.span < view.span);
  });

  test('zoom cannot go below a one-year window', () => {
    let view = createView(1500, 1501, 1000);
    for (let i = 0; i < 40; i++) view = view.zoomAbout(500, 0.5);
    assert.ok(view.span >= 1, `span collapsed to ${view.span}`);
  });

  test('zoom cannot exceed the full range', () => {
    let view = createView(-4540000000, 2020, 1400);
    for (let i = 0; i < 20; i++) view = view.zoomAbout(700, 4);
    assert.ok(view.from >= ORIGIN_YEAR - 1);
    assert.ok(view.to <= presentYear() + 1);
  });

  test('pan moves the window and is reversible', () => {
    // Panning happens in sp-space so the year under the cursor tracks the drag.
    // That means the year-span shifts a little; the invariant that matters is
    // that panning back by the same distance restores the original window.
    const view = createView(1500, 1600, 1000);
    const panned = view.pan(100);
    assert.notEqual(panned.from, view.from);
    assert.ok(panned.from > view.from, 'panning right moves the window later');

    const back = panned.pan(-100);
    assert.ok(Math.abs(back.from - view.from) < 1e-6);
    assert.ok(Math.abs(back.to - view.to) < 1e-6);
  });
});

describe('ticks', () => {
  const windows = [
    [-4540000000, 2020],
    [-66000000, 2020],
    [-100000, 2020],
    [-3000, 2020],
    [-600, 600],
    [1500, 1600],
  ];

  for (const [from, to] of windows) {
    test(`at most 12 ticks for ${from}..${to}`, () => {
      const ticks = createView(from, to, 1400).ticks();
      assert.ok(ticks.length <= 12, `got ${ticks.length} ticks`);
      assert.ok(ticks.length >= 2, `got ${ticks.length} ticks`);
    });

    test(`ticks are ascending and inside the window for ${from}..${to}`, () => {
      const ticks = createView(from, to, 1400).ticks();
      for (let i = 1; i < ticks.length; i++) {
        assert.ok(ticks[i].year > ticks[i - 1].year);
      }
      assert.ok(ticks[0].year >= from && ticks[ticks.length - 1].year <= to);
    });
  }

  test('labels use the right unit at each scale', () => {
    const labels = (f, t) => createView(f, t, 1400).ticks().map((x) => x.label);
    assert.ok(labels(-4540000000, 2020).some((l) => /Ga|Ma/.test(l)));
    assert.ok(labels(-100000, -20000).some((l) => /ka/.test(l)));
    assert.ok(labels(-600, -100).some((l) => /BCE/.test(l)));
    assert.ok(labels(1500, 1600).some((l) => /^15\d\d$/.test(l)));
  });

  test('every tick carries a year and a label', () => {
    for (const t of createView(-3000, 2020, 1400).ticks()) {
      assert.equal(typeof t.year, 'number');
      assert.equal(typeof t.label, 'string');
      assert.ok(t.label.length > 0);
      assert.equal(typeof t.major, 'boolean');
    }
  });
});

describe('ticks are spread across the axis', () => {
  // Regression: deep-time samples were snapped with a step larger than the
  // year's own magnitude, rounding them to zero and piling every label up at
  // the present.
  const windows = [
    [ORIGIN_YEAR, 2020],
    [-66000000, 2020],
    [-3000, 2020],
    [-2000, 2000],
    [-600, 600],
    [-100, 100],
    [1500, 1600],
  ];

  for (const [from, to] of windows) {
    test(`no clustering for ${from}..${to}`, () => {
      const view = createView(from, to, 1400);
      const xs = view.ticks().map((t) => view.project(t.year));
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      assert.ok(min > 8, `ticks only ${min.toFixed(1)}px apart`);
      assert.ok(max / min < 5, `gap ratio ${(max / min).toFixed(1)} is too uneven`);
    });

    test(`ticks span most of the axis for ${from}..${to}`, () => {
      const view = createView(from, to, 1400);
      const xs = view.ticks().map((t) => view.project(t.year));
      assert.ok(Math.max(...xs) - Math.min(...xs) > 1400 * 0.6,
        'ticks cover less than 60% of the width');
    });
  }
});

describe('the view honours the anchored budget', () => {
  // Regression: createView projected linearly in raw sp-space, which bypassed
  // the anchors entirely and handed recorded history ~12% of the axis - the
  // pure-log behaviour the anchors exist to avoid.
  test('recorded history gets ~48% of the full-range axis', () => {
    const view = createView(ORIGIN_YEAR, presentYear(), 1000);
    const share = (view.widthPx - view.project(-3000)) / view.widthPx;
    assert.ok(Math.abs(share - 0.48) < 0.01,
      `recorded history got ${(share * 100).toFixed(1)}% of the axis`);
  });

  test('the Pleistocene gets ~12% of the full-range axis', () => {
    const view = createView(ORIGIN_YEAR, presentYear(), 1000);
    const share = (view.project(-11700) - view.project(-2580000)) / view.widthPx;
    assert.ok(Math.abs(share - 0.12) < 0.01,
      `Pleistocene got ${(share * 100).toFixed(1)}% of the axis`);
  });
});

describe('deep-time tick labels are round', () => {
  // Deep-time ticks snap in years-before-present, because the label is a BP
  // value: snapping the historical year instead yields "602 ka" and "81.9 ka".
  const windows = [[ORIGIN_YEAR, 2020], [-66000000, 2020], [-2000000, -5000]];

  for (const [from, to] of windows) {
    test(`${from}..${to}`, () => {
      for (const tick of createView(from, to, 1400).ticks()) {
        const m = tick.label.match(/^([\d.]+) (ka|Ma|Ga)$/);
        if (!m) continue;
        const value = Number(m[1]);
        const mantissa = value / 10 ** Math.floor(Math.log10(value));
        assert.ok([1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9].some(
          (x) => Math.abs(mantissa - x) < 0.01),
          `"${tick.label}" is not a round value`);
      }
    });
  }
});

describe('uniform windows produce gap-free ticks', () => {
  // Regression: two unit-space samples could snap to the same year, and the
  // dedupe left a hole - "1550 1551 1552 1553 1554 1556" reads as a bug.
  // Windows narrow enough to sit inside ONE anchor segment, where the scale is
  // near-linear and an even year-step is achievable. A window spanning several
  // segments - [-2000, 2000] or [-600, 600], which cross the -500 and 500
  // anchors - compresses unevenly, so its ticks legitimately vary in step and
  // some get thinned out to stay readable. Even *pixel* spacing is the
  // contract there, and the clustering suite above covers it.
  const windows = [[1550, 1560], [1500, 1600], [1900, 2000], [-600, -500],
    [-100, 100], [-20, 20]];

  for (const [from, to] of windows) {
    test(`${from}..${to} has an even step`, () => {
      const years = createView(from, to, 1400).ticks().map((t) => t.year);
      const gaps = years.slice(1).map((y, i) => y - years[i]);
      const step = Math.min(...gaps);
      // Every gap is one step, except that a window crossing the BCE/CE seam
      // skips the year that does not exist and leaves one double gap there.
      const doubles = gaps.filter((g) => g !== step);
      assert.ok(doubles.every((g) => g === step * 2) && doubles.length <= 1,
        `uneven steps ${[...new Set(gaps)].join(',')} in ${years.join(' ')}`);
    });

    test(`${from}..${to} labels round years`, () => {
      for (const year of createView(from, to, 1400).ticks().map((t) => t.year)) {
        assert.notEqual(year, 0, 'year zero is not a year');
      }
    });
  }
});

describe('the year-zero boundary', () => {
  // The scale is continuous through 1 BCE / 1 CE, but historical numbering is
  // not. Every bit of tick arithmetic has to cross that seam astronomically.

  test('span counts elapsed years, not the phantom year zero', () => {
    // 1 BCE to 1 CE is one elapsed year. Raw subtraction says two, which makes
    // the one-year zoom clamp stop a full year early.
    assert.equal(createView(-1, 1, 1000).span, 1);
    assert.equal(createView(1526, 1857, 1000).span, 331);
  });

  test('ticks do not throw on a sub-year window straddling year zero', () => {
    assert.doesNotThrow(() => createView(-1.0046, 0.0047, 1400).ticks());
  });

  test('ticks survive zooming all the way in on the boundary', () => {
    let view = createView(-50, 50, 1000);
    const px = view.project(-1);
    for (let i = 0; i < 60; i++) view = view.zoomAbout(px, 0.7);
    assert.doesNotThrow(() => view.ticks());
    assert.ok(view.span >= 1, `span collapsed to ${view.span}`);
  });

  test('no tick is ever year zero', () => {
    for (const [from, to] of [[-100, 100], [-5, 5], [-2000, 2000], [-1, 2]]) {
      for (const tick of createView(from, to, 1400).ticks()) {
        assert.notEqual(tick.year, 0, `year zero emitted for ${from}..${to}`);
      }
    }
  });

  test('labels across the boundary read correctly', () => {
    const labels = createView(-100, 100, 1400).ticks().map((t) => t.label);
    assert.ok(labels.some((l) => /BCE$/.test(l)), 'expected a BCE label');
    assert.ok(labels.some((l) => /CE$/.test(l)), 'expected a CE label');
  });
});

describe('tick density follows the available width', () => {
  // A phone gives the plot area under 300px. Nine labels there overlap into
  // "4 G400 Ma30 Ma600 ka", which is worse than showing four.
  test('a narrow axis gets fewer ticks', () => {
    const narrow = createView(ORIGIN_YEAR, 2020, 280).ticks();
    const wide = createView(ORIGIN_YEAR, 2020, 1400).ticks();
    assert.ok(narrow.length < wide.length,
      `narrow ${narrow.length} vs wide ${wide.length}`);
    assert.ok(narrow.length >= 2, 'at least two ticks');
  });

  test('labels have room to breathe at every width', () => {
    for (const width of [240, 280, 375, 600, 1024, 1400]) {
      for (const [from, to] of [[ORIGIN_YEAR, 2020], [-3000, 2020], [1500, 1600]]) {
        const view = createView(from, to, width);
        const xs = view.ticks().map((t) => view.project(t.year));
        const gaps = xs.slice(1).map((x, i) => x - xs[i]);
        assert.ok(Math.min(...gaps) >= 55,
          `${width}px ${from}..${to}: ticks only ${Math.min(...gaps).toFixed(0)}px apart`);
      }
    }
  });

  test('a wide axis still caps at twelve', () => {
    assert.ok(createView(ORIGIN_YEAR, 2020, 3000).ticks().length <= 12);
  });
});
