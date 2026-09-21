/**
 * Full-range strip under the timeline, showing where the current window sits.
 *
 * Its own view is always the whole 4.54 billion years, so however far the main
 * timeline zooms in, the minimap keeps the answer to "where am I?" on screen.
 * Dragging it moves the main window without changing the zoom.
 */

import { elapsed } from './format.js';
import { createView } from './timescale.js';
import { FULL_RANGE } from './eras.js';

/*
 * Marks grow with the strip rather than sitting at a fixed 3px. The cap only
 * bites on a tall strip - a phone's - where the old one left the lower third
 * empty; a desktop strip is short enough that the height, not the cap, decides.
 */
const MAX_PITCH = 9;
const MARK_GAP = 1;
const PAD_Y = 4;

export function createMinimap(canvas, { entries = [], lanes = [], onWindow } = {}) {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let view = null;
  let window_ = { ...FULL_RANGE };
  let theme = null;
  let frame = null;

  const laneOrder = lanes.map((lane) => lane.id);

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    const colours = {};
    for (const lane of lanes) colours[lane.id] = read(lane.color, '#57524a');
    return {
      bg: read('--bg-sunken', '#f2f0ea'),
      ink: read('--ink', '#1c1a17'),
      rule: read('--rule-strong', '#c4bdaf'),
      select: read('--select', '#116b86'),
      lanes: colours,
    };
  }

  function schedule() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; draw(); });
  }

  function draw() {
    if (!view) return;
    theme = readTheme();

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    // One thin mark per entry, stacked by lane, so the strip reads as a
    // density map of where the dataset actually has material.
    const rows = Math.max(1, laneOrder.length);
    const pitch = Math.min(MAX_PITCH, (height - PAD_Y * 2) / rows);
    ctx.globalAlpha = 0.75;
    for (const entry of entries) {
      const row = Math.max(0, laneOrder.indexOf(entry.lane));
      const x0 = view.project(entry.sMin);
      const x1 = view.project(entry.eMax);
      ctx.fillStyle = theme.lanes[entry.lane] ?? theme.ink;
      ctx.fillRect(x0, PAD_Y + row * pitch, Math.max(1, x1 - x0), Math.max(1, pitch - MARK_GAP));
    }
    ctx.globalAlpha = 1;

    // Current window
    const a = view.project(window_.from);
    const b = view.project(window_.to);
    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(0, 0, a, height);
    ctx.fillRect(b, 0, width - b, height);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = theme.select;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a + 0.5, 1, Math.max(2, b - a - 1), height - 2);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = createView(FULL_RANGE.from, FULL_RANGE.to, width);
    schedule();
  }

  /** Centre the current window on the year under `px`, keeping its span. */
  function moveTo(px) {
    const centre = view.unproject(Math.max(0, Math.min(width, px)));
    const half = elapsed(window_.from, window_.to) / 2;
    onWindow?.(centre - half, centre + half);
  }

  let dragging = false;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    dragging = true;
    moveTo(event.clientX - canvas.getBoundingClientRect().left);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    moveTo(event.clientX - canvas.getBoundingClientRect().left);
  });

  const end = (event) => {
    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    setWindow(from, to) {
      window_ = { from, to };
      schedule();
    },
    redraw: schedule,
    /** Canvas x for a year, for verification. */
    project: (year) => view.project(year),
  };
}
