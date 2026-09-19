/**
 * Canvas renderer for the timeline.
 *
 * Canvas rather than DOM because the dataset reaches tens of thousands of
 * entries and per-frame transforms on that many nodes would jank. Everything
 * geometric lives in timescale.js and layout.js, both pure and unit-tested;
 * this file draws, handles input, and owns nothing else.
 */

import { createView, ORIGIN_YEAR, presentYear } from './timescale.js';
import { formatYear, roundYear } from './format.js';
import { hitRow, packLanes } from './layout.js';
import { FLAG_UNCERTAIN_END, FLAG_UNCERTAIN_START } from './store.js';

const AXIS_H = 34;
const BAR_H = 14;
const BAR_GAP = 4;
const LANE_PAD_Y = 6;
const LANE_SEP = 1;
const MIN_BAR_W = 3;
const MAX_ROWS = 6;
const COLLAPSED_BAR_H = 5;

/** Padding added to each target's hit box, so a 3px bar is still clickable. */
const HIT_PAD = 10;

const GUTTER_W = 150;
const GUTTER_W_NARROW = 92;
const NARROW_PX = 680;

/** Below this window width a lane with sub-regions splits into them. */
const SUBLANE_SPAN = 2000;

/** Only the subcontinent expands; splitting every lane would give ~35 rows. */
const EXPANDABLE = new Set(['india']);

export function createTimeline(canvas, { entries = [], lanes = [], onViewChange, onSelect } = {}) {
  const ctx = canvas.getContext('2d');

  let view = null;
  let width = 0;
  let height = 0;
  let gutter = GUTTER_W;
  let scrollY = 0;
  let contentH = 0;
  let theme = null;
  let layout = [];
  let frame = null;

  const collapsed = new Set();
  let selectedId = null;
  let hover = null;
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));

  // ---- theme -------------------------------------------------------------

  function readTheme() {
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    const colours = {};
    for (const lane of lanes) colours[lane.id] = read(lane.color, '#57524a');
    return {
      bg: read('--bg', '#fbfaf7'),
      bgRaised: read('--bg-raised', '#ffffff'),
      bgSunken: read('--bg-sunken', '#f2f0ea'),
      ink: read('--ink', '#1c1a17'),
      inkSoft: read('--ink-soft', '#57524a'),
      inkFaint: read('--ink-faint', '#8b847a'),
      rule: read('--rule', '#ddd8ce'),
      ruleStrong: read('--rule-strong', '#c4bdaf'),
      lanes: colours,
    };
  }

  const laneColour = (id) =>
    theme.lanes[id] || theme.lanes[laneById.get(id)?.id] || theme.inkSoft;

  /** Same colour at low alpha, for the faded edge of an uncertain bound.
   *  Hex alpha rather than color-mix(): an unparseable colour makes
   *  addColorStop throw, which would abort the whole frame. */
  const faded = (colour) =>
    (/^#[0-9a-f]{6}$/i.test(colour) ? `${colour}38` : colour);

  // ---- lane model --------------------------------------------------------

  /**
   * Which rows to show, and what to group entries by.
   *
   * At a wide window the ten lanes are enough. Zoomed inside two millennia the
   * subcontinent carries most of the detail, so it splits into its sub-regions
   * - the spine carries both `lane` and `region` for exactly this.
   */
  function laneModel() {
    const expand = view.span < SUBLANE_SPAN;
    const order = [];
    const labels = new Map();
    const colours = new Map();

    for (const lane of lanes) {
      order.push(lane.id);
      labels.set(lane.id, lane.label);
      colours.set(lane.id, lane.id);
      if (!expand || !EXPANDABLE.has(lane.id)) continue;
      for (const sub of lane.subRegions ?? []) {
        order.push(sub);
        labels.set(sub, lane.subRegionLabels?.[sub] ?? sub);
        colours.set(sub, lane.id);
      }
    }
    return { order, labels, colours, key: expand ? 'region' : 'lane' };
  }

  function computeLayout() {
    const model = laneModel();
    const packed = packLanes(entries, model.order, view, {
      maxRows: MAX_ROWS,
      minWidthPx: MIN_BAR_W,
      laneKey: model.key,
    });

    let y = 0;
    const laid = packed.map((lane) => {
      const isCollapsed = collapsed.has(lane.lane);
      const rowCount = Math.max(1, lane.rows.length);
      const h = isCollapsed
        ? LANE_PAD_Y * 2 + COLLAPSED_BAR_H
        : LANE_PAD_Y * 2 + rowCount * (BAR_H + BAR_GAP) - BAR_GAP;
      const out = {
        ...lane,
        label: model.labels.get(lane.lane) ?? lane.lane,
        colourKey: model.colours.get(lane.lane) ?? lane.lane,
        collapsed: isCollapsed,
        y,
        h,
        count: lane.rows.flat().length + lane.hidden,
      };
      y += h + LANE_SEP;
      return out;
    });

    contentH = y;
    scrollY = Math.max(0, Math.min(scrollY, Math.max(0, contentH - (height - AXIS_H))));
    return laid;
  }

  // ---- drawing -----------------------------------------------------------

  function drawAxis() {
    ctx.fillStyle = theme.bgRaised;
    ctx.fillRect(0, 0, width, AXIS_H);

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (const tick of view.ticks()) {
      const x = Math.round(gutter + view.project(tick.year)) + 0.5;

      ctx.strokeStyle = tick.major ? theme.ruleStrong : theme.rule;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H - (tick.major ? 9 : 5));
      ctx.lineTo(x, AXIS_H);
      ctx.stroke();

      ctx.strokeStyle = theme.rule;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = theme.inkSoft;
      ctx.textAlign = x < gutter + 30 ? 'left' : x > width - 34 ? 'right' : 'center';
      ctx.fillText(tick.label, Math.max(x, gutter + 2), AXIS_H / 2 - 3);
    }

    ctx.strokeStyle = theme.rule;
    ctx.beginPath();
    ctx.moveTo(0, AXIS_H - 0.5);
    ctx.lineTo(width, AXIS_H - 0.5);
    ctx.stroke();
  }

  function drawBar(item, y, colour, h = BAR_H) {
    const fuzzyStart = item.entry.flags & FLAG_UNCERTAIN_START;
    const fuzzyEnd = item.entry.flags & FLAG_UNCERTAIN_END;

    if (fuzzyStart || fuzzyEnd) {
      // An uncertain bound fades out, so a bracketed date never reads as exact.
      const grad = ctx.createLinearGradient(item.x0, 0, item.x0 + item.w, 0);
      const soft = faded(colour);
      const edge = Math.min(0.3, 22 / Math.max(item.w, 1));
      grad.addColorStop(0, fuzzyStart ? soft : colour);
      grad.addColorStop(edge, colour);
      grad.addColorStop(1 - edge, colour);
      grad.addColorStop(1, fuzzyEnd ? soft : colour);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = colour;
    }
    ctx.fillRect(item.x0, y, item.w, h);
  }

  function drawPoint(item, mid, colour) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(item.x0, mid - 5);
    ctx.lineTo(item.x0 + 5, mid);
    ctx.lineTo(item.x0, mid + 5);
    ctx.lineTo(item.x0 - 5, mid);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Label a bar if it fits inside, else to its right when the gap allows.
   *
   * Importance breaks the tie when space is short: at a wide window the lanes
   * are dense enough that labelling everything would be unreadable, so minor
   * entries give up their label before major ones do.
   */
  function drawLabel(item, next, mid, minImportance) {
    if (item.entry.imp < minImportance) return;
    const label = item.entry.title;
    const textW = ctx.measureText(label).width;

    if (!item.point) {
      // Clamp the label into the visible span of the bar. Long-running entries
      // - an empire spanning the whole window - start off-canvas, and a label
      // pinned to the true left edge would simply never be drawn.
      const left = Math.max(item.x0, 0);
      const right = Math.min(item.x0 + item.w, width - gutter);
      if (right - left >= textW + 12) {
        ctx.fillStyle = theme.bg;
        ctx.textAlign = 'left';
        ctx.fillText(label, left + 6, mid);
        return;
      }
    }

    const room = (next ? next.x0 : width - gutter) - (item.x0 + item.w) - 10;
    if (room >= textW) {
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'left';
      ctx.fillText(label, item.x0 + item.w + (item.point ? 6 : 5), mid);
    }
  }

  function drawLane(lane) {
    const top = AXIS_H + lane.y - scrollY;
    if (top > height || top + lane.h < AXIS_H) return;

    const colour = laneColour(lane.colourKey);

    // Lane band
    ctx.fillStyle = theme.bg;
    ctx.fillRect(gutter, top, width - gutter, lane.h);

    // Gutter header
    ctx.fillStyle = theme.bgRaised;
    ctx.fillRect(0, top, gutter, lane.h);
    ctx.fillStyle = colour;
    ctx.fillRect(0, top, 3, lane.h);

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.ink;
    const headerY = top + Math.min(lane.h / 2, 14);
    const maxLabel = gutter - 34;
    let label = lane.label;
    while (ctx.measureText(label).width > maxLabel && label.length > 4) {
      label = `${label.slice(0, -2)}…`;
    }
    ctx.fillText(label, 10, headerY);

    ctx.fillStyle = theme.inkFaint;
    ctx.textAlign = 'right';
    ctx.fillText(lane.collapsed ? `${lane.count} ›` : String(lane.count),
      gutter - 8, headerY);

    // Separator
    ctx.strokeStyle = theme.rule;
    ctx.beginPath();
    ctx.moveTo(0, top + lane.h + 0.5);
    ctx.lineTo(width, top + lane.h + 0.5);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, Math.max(top, AXIS_H), width - gutter,
      Math.min(lane.h, top + lane.h - AXIS_H));
    ctx.clip();
    // layout.js works in timeline-area coordinates, where 0 is view.from. The
    // gutter offset is applied once, here, so bars land under their own axis.
    ctx.translate(gutter, 0);

    if (lane.collapsed) {
      const y = top + LANE_PAD_Y;
      ctx.globalAlpha = 0.55;
      for (const item of lane.rows.flat()) drawBar(item, y, colour, COLLAPSED_BAR_H);
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    // Dense lanes drop minor labels first.
    const density = lane.rows.flat().length / Math.max(1, (width - gutter) / 120);
    const minImportance = density > 2.2 ? 4 : density > 1.2 ? 3 : 1;

    lane.rows.forEach((row, r) => {
      const y = top + LANE_PAD_Y + r * (BAR_H + BAR_GAP);
      const mid = y + BAR_H / 2;
      row.forEach((item, i) => {
        if (item.point) drawPoint(item, mid, colour);
        else drawBar(item, y, colour);
        if (item.entry.id === selectedId) {
          ctx.strokeStyle = theme.ink;
          ctx.lineWidth = 2;
          ctx.strokeRect(item.x0 - 1.5, y - 1.5, item.w + 3, BAR_H + 3);
          ctx.lineWidth = 1;
        }
        drawLabel(item, row[i + 1], mid, minImportance);
      });
    });

    if (lane.hidden > 0) {
      const text = `+${lane.hidden} more`;
      const w = ctx.measureText(text).width + 10;
      const y = top + lane.h - LANE_PAD_Y - BAR_H;
      const right = width - gutter;
      ctx.fillStyle = theme.bgSunken;
      ctx.fillRect(right - w - 6, y, w, BAR_H);
      ctx.fillStyle = theme.inkSoft;
      ctx.textAlign = 'right';
      ctx.fillText(text, right - 11, y + BAR_H / 2);
    }

    ctx.restore();
  }

  /**
   * Crosshair, year readout, and the name of the lane under the cursor.
   *
   * On a scale this compressed a bar's position is not readable on its own -
   * being able to point at it and get the year is what makes the axis usable.
   */
  function drawHover() {
    if (!hover) return;
    const x = Math.round(hover.x) + 0.5;

    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, AXIS_H);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Year badge, pinned to the axis so it never covers the lane it describes.
    const yearText = formatYear(roundYear(hover.year));
    const yearW = ctx.measureText(yearText).width + 12;
    const yearX = Math.min(Math.max(x - yearW / 2, gutter + 2), width - yearW - 2);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(yearX, 4, yearW, AXIS_H - 10);
    ctx.fillStyle = theme.bg;
    ctx.textAlign = 'center';
    ctx.fillText(yearText, yearX + yearW / 2, 4 + (AXIS_H - 10) / 2);

    // Lane name, and the entry under the cursor when there is one.
    const lines = [hover.laneLabel];
    if (hover.item) {
      const e = hover.item.entry;
      const span = e.sMin === e.eMax
        ? formatYear(e.sMin)
        : `${formatYear(e.sMin)} \u2013 ${formatYear(e.eMax)}`;
      lines.unshift(e.title, span);
    }
    if (!lines.length) return;

    const padding = 7;
    const lineH = 15;
    const boxW = Math.max(...lines.map((t) => ctx.measureText(t).width)) + padding * 2;
    const boxH = lines.length * lineH + padding * 2 - 3;
    const bx = Math.min(hover.x + 14, width - boxW - 6);
    const by = Math.min(hover.y + 14, height - boxH - 6);

    ctx.fillStyle = theme.bgRaised;
    ctx.strokeStyle = theme.ruleStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, boxW, boxH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    lines.forEach((text, i) => {
      ctx.fillStyle = i === lines.length - 1 ? theme.inkFaint : theme.ink;
      ctx.fillText(text, bx + padding, by + padding + i * lineH + 5);
    });
  }

  function draw() {
    if (!view) return;
    theme = readTheme();
    layout = computeLayout();

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    for (const lane of layout) drawLane(lane);

    drawAxis();

    // Gutter edge, drawn last so lane bands cannot bleed over it.
    ctx.strokeStyle = theme.ruleStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gutter + 0.5, 0);
    ctx.lineTo(gutter + 0.5, height);
    ctx.stroke();

    drawHover();
  }

  // ---- view --------------------------------------------------------------

  function timelineWidth() {
    return Math.max(1, width - gutter);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    gutter = width < NARROW_PX ? GUTTER_W_NARROW : GUTTER_W;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (view) view = createView(view.from, view.to, timelineWidth());
    schedule();
  }

  function setView(from, to) {
    view = createView(from, to, timelineWidth());
    schedule();
    onViewChange?.(view);
  }

  function schedule() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; draw(); });
  }

  /**
   * The entry under a client point, or null.
   *
   * Lanes are scanned by y, then the row index falls out of the fixed row
   * pitch, so only one packed row is ever searched.
   */
  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    if (cx < gutter || cy < AXIS_H) return null;

    const x = cx - gutter;
    const y = cy - AXIS_H + scrollY;
    const lane = layout.find((l) => y >= l.y && y < l.y + l.h);
    if (!lane) return null;

    if (lane.collapsed) {
      const flat = [...lane.rows.flat()].sort((a, b) => a.x0 - b.x0);
      return hitRow(flat, x, HIT_PAD);
    }

    const row = lane.rows[Math.floor((y - lane.y - LANE_PAD_Y) / (BAR_H + BAR_GAP))];
    return row ? hitRow(row, x, HIT_PAD) : null;
  }

  function laneAt(clientY) {
    const y = clientY - canvas.getBoundingClientRect().top - AXIS_H + scrollY;
    return layout.find((lane) => y >= lane.y && y < lane.y + lane.h);
  }

  // ---- input -------------------------------------------------------------

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left - gutter;

    // Shift keeps the old vertical-scroll gesture for stepping through lanes.
    if (event.shiftKey) {
      scrollY += event.deltaY;
      schedule();
      return;
    }

    // A two-finger trackpad swipe sideways slides through time; up and down
    // zooms. Whichever axis dominates wins, so a slightly diagonal swipe still
    // does one thing rather than both at once.
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      view = view.pan(event.deltaX);
    } else {
      // Trackpads report fine-grained deltas; clamp so one flick is not a leap.
      const intensity = Math.min(Math.abs(event.deltaY), 50) / 50;
      const factor = event.deltaY < 0 ? 1 - 0.45 * intensity : 1 + 0.8 * intensity;
      view = view.zoomAbout(px, factor);
    }
    schedule();
    onViewChange?.(view);
  }, { passive: false });

  let dragging = null;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY, moved: false };
  });

  function trackHover(event) {
    const rect = canvas.getBoundingClientRect();
    const cx = event.clientX - rect.left;
    const cy = event.clientY - rect.top;

    // The cursor says what each region does: the lane gutter toggles a lane,
    // the axis is not interactive, and the plot area reads a year.
    if (cy < AXIS_H) {
      canvas.style.cursor = 'default';
      if (hover) { hover = null; schedule(); }
      return;
    }
    if (cx < gutter) {
      canvas.style.cursor = laneAt(event.clientY) ? 'pointer' : 'default';
      if (hover) { hover = null; schedule(); }
      return;
    }

    const lane = laneAt(event.clientY);
    const item = hitTest(event.clientX, event.clientY);
    hover = {
      x: cx,
      y: cy,
      year: view.unproject(cx - gutter),
      laneLabel: lane?.label ?? '',
      item,
    };
    canvas.style.cursor = dragging ? 'grabbing' : item ? 'pointer' : 'crosshair';
    schedule();
  }

  canvas.addEventListener('pointermove', trackHover);
  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = 'default';
    if (!hover) return;
    hover = null;
    schedule();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.moved = true;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    if (dx) view = view.pan(-dx);
    if (dy) scrollY -= dy;
    schedule();
    if (dx) onViewChange?.(view);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    const wasDrag = dragging.moved;
    dragging = null;
    canvas.releasePointerCapture?.(event.pointerId);
    if (wasDrag) return;

    // A click in the gutter toggles that lane.
    const rect = canvas.getBoundingClientRect();
    if (event.clientX - rect.left < gutter) {
      const lane = laneAt(event.clientY);
      if (lane) {
        if (collapsed.has(lane.lane)) collapsed.delete(lane.lane);
        else collapsed.add(lane.lane);
        schedule();
      }
      return;
    }

    const hit = hitTest(event.clientX, event.clientY);
    onSelect?.(hit ? hit.entry : null);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  resize();
  setView(ORIGIN_YEAR, presentYear());

  return {
    get view() { return view; },
    get layout() { return layout; },
    get gutter() { return gutter; },
    /** Canvas x at which an item's left edge is drawn. */
    screenX: (item) => gutter + item.x0,
    get scrollY() { return scrollY; },
    get contentHeight() { return contentH; },
    setView,
    redraw: schedule,
    hitTest,
    /** Current hover readout, for verification. */
    get hover() { return hover; },
    select(id) {
      selectedId = id;
      schedule();
    },
    /** Pixel geometry of a currently laid-out entry, or null. */
    itemFor(id) {
      for (const lane of layout) {
        for (const item of lane.rows.flat()) if (item.entry.id === id) return item;
      }
      return null;
    },
    toggleLane: (id) => {
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      schedule();
    },
  };
}
