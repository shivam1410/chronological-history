/**
 * Canvas renderer for the timeline.
 *
 * Canvas rather than DOM because the dataset reaches tens of thousands of
 * entries and per-frame transforms on that many nodes would jank. Everything
 * geometric lives in timescale.js, which is pure and unit-tested; this file
 * only draws and handles input.
 */

import { createView, ORIGIN_YEAR, presentYear } from './timescale.js';
import { FLAG_UNCERTAIN_END, FLAG_UNCERTAIN_START } from './store.js';

const AXIS_H = 34;
const PAD_X = 0;
const BAR_H = 14;
const BAR_GAP = 4;
const MIN_BAR_W = 2;

// Phase 1 spreads bars over a fixed number of rows just so the skeleton is
// legible. Phase 2.1 replaces this with real first-fit interval packing in
// layout.js, which is where per-lane row assignment belongs.
const PLACEHOLDER_ROWS = 18;

export function createTimeline(canvas, { entries = [], onViewChange } = {}) {
  const ctx = canvas.getContext('2d');
  let view = null;
  let width = 0;
  let height = 0;
  let frame = null;

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
    return value || fallback;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (view) view = createView(view.from, view.to, width - PAD_X * 2);
    schedule();
  }

  function setView(from, to) {
    view = createView(from, to, Math.max(1, width - PAD_X * 2));
    schedule();
    onViewChange?.(view);
  }

  function schedule() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; draw(); });
  }

  function drawAxis() {
    const ink = cssVar('--ink-soft', '#57524a');
    const rule = cssVar('--rule', '#ddd8ce');
    const ruleStrong = cssVar('--rule-strong', '#c4bdaf');

    ctx.fillStyle = cssVar('--bg-raised', '#fff');
    ctx.fillRect(0, 0, width, AXIS_H);
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, AXIS_H - 0.5);
    ctx.lineTo(width, AXIS_H - 0.5);
    ctx.stroke();

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (const tick of view.ticks()) {
      const x = Math.round(PAD_X + view.project(tick.year)) + 0.5;

      ctx.strokeStyle = tick.major ? ruleStrong : rule;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H - (tick.major ? 9 : 5));
      ctx.lineTo(x, AXIS_H);
      ctx.stroke();

      // Full-height guide behind the content.
      ctx.strokeStyle = rule;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = ink;
      ctx.textAlign = x < 34 ? 'left' : x > width - 34 ? 'right' : 'center';
      ctx.fillText(tick.label, x, AXIS_H / 2 - 3);
    }
  }

  /** Entries overlapping the visible window, with their pixel geometry. */
  function visible() {
    const out = [];
    entries.forEach((entry, index) => {
      if (entry.eMax < view.from || entry.sMin > view.to) return;
      const x0 = view.project(entry.sMin);
      const x1 = view.project(entry.eMax);
      out.push({
        entry,
        x0,
        x1,
        w: Math.max(MIN_BAR_W, x1 - x0),
        row: index % PLACEHOLDER_ROWS,
        point: entry.sMin === entry.eMax,
      });
    });
    return out;
  }

  function laneColour(lane) {
    return cssVar(`--lane-${lane}`, cssVar('--ink-soft', '#57524a'));
  }

  /**
   * Same colour at low alpha, for the faded edge of an uncertain bound.
   *
   * Appends hex alpha rather than using color-mix(): an unparseable colour
   * makes addColorStop throw, which would abort the whole frame.
   */
  function faded(colour) {
    return /^#[0-9a-f]{6}$/i.test(colour) ? `${colour}38` : colour;
  }

  function drawEntries(items) {
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (const item of items) {
      const y = AXIS_H + BAR_GAP + item.row * (BAR_H + BAR_GAP);
      if (y > height) continue;
      const colour = laneColour(item.entry.lane);
      const mid = y + BAR_H / 2;

      if (item.point) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(item.x0, mid - 5);
        ctx.lineTo(item.x0 + 5, mid);
        ctx.lineTo(item.x0, mid + 5);
        ctx.lineTo(item.x0 - 5, mid);
        ctx.closePath();
        ctx.fill();
      } else {
        // Uncertain bounds fade out, so a bracketed date never reads as exact.
        const fuzzyStart = item.entry.flags & FLAG_UNCERTAIN_START;
        const fuzzyEnd = item.entry.flags & FLAG_UNCERTAIN_END;
        if (fuzzyStart || fuzzyEnd) {
          const grad = ctx.createLinearGradient(item.x0, 0, item.x0 + item.w, 0);
          const soft = faded(colour);
          grad.addColorStop(0, fuzzyStart ? soft : colour);
          grad.addColorStop(Math.min(0.28, 24 / item.w), colour);
          grad.addColorStop(Math.max(0.72, 1 - 24 / item.w), colour);
          grad.addColorStop(1, fuzzyEnd ? soft : colour);
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = colour;
        }
        ctx.fillRect(item.x0, y, item.w, BAR_H);
      }

      const label = item.entry.title;
      const labelW = ctx.measureText(label).width;
      const room = item.point ? width - item.x0 - 10 : item.w - 10;
      if (room > labelW && (item.point || item.w > 40)) {
        ctx.fillStyle = item.point ? cssVar('--ink', '#000') : contrastInk();
        ctx.textAlign = 'left';
        ctx.fillText(label, item.x0 + (item.point ? 9 : 5), mid);
      }
    }
  }

  function contrastInk() {
    // Lane fills are mid-tone in both themes; the page background inverts, so
    // the readable text colour on a bar is the background, not the ink.
    return cssVar('--bg', '#fbfaf7');
  }

  function draw() {
    if (!view) return;
    ctx.fillStyle = cssVar('--bg', '#fbfaf7');
    ctx.fillRect(0, 0, width, height);
    drawAxis();
    lastVisible = visible();
    drawEntries(lastVisible);
  }

  let lastVisible = [];

  // ---- input -------------------------------------------------------------

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left - PAD_X;
    // Trackpads report fine-grained deltas; clamp so one flick is not a leap.
    const intensity = Math.min(Math.abs(event.deltaY), 50) / 50;
    const factor = event.deltaY < 0 ? 1 - 0.45 * intensity : 1 + 0.8 * intensity;
    view = view.zoomAbout(px, factor);
    schedule();
    onViewChange?.(view);
  }, { passive: false });

  let dragging = null;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    if (dx === 0) return;
    dragging.x = event.clientX;
    view = view.pan(-dx);
    schedule();
    onViewChange?.(view);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    dragging = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  resize();
  setView(ORIGIN_YEAR, presentYear());

  return {
    get view() { return view; },
    get visible() { return lastVisible; },
    setView,
    redraw: schedule,
  };
}
