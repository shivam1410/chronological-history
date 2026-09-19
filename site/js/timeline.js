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
import { wrapText } from './wrap.js';

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

// The lane gutter has to stay legible without eating a phone screen: at 375px
// a 150px gutter is 40% of the viewport.
const GUTTER_TIERS = [
  { upTo: 460, width: 96 },
  { upTo: 760, width: 112 },
  { upTo: Infinity, width: 150 },
];

/** Lane names wrap rather than truncate; this caps how far they wrap. */
const LANE_LABEL_LINES = 3;
const LANE_LINE_H = 13;

/** Fewer stacked rows on a small screen, so a lane is not taller than the view
 *  and the wrapped lane name has room to sit beside it. */
const NARROW_PX = 760;
const MAX_ROWS_NARROW = 2;

const LANE_FONT = '11px ui-sans-serif, system-ui, sans-serif';

/** Below this window width a lane with sub-regions splits into them. */
const SUBLANE_SPAN = 2000;

/** Only the subcontinent expands; splitting every lane would give ~35 rows. */
const EXPANDABLE = new Set(['india']);

export function createTimeline(canvas, {
  entries = [], lanes = [], onViewChange, onSelect, onPickYear,
} = {}) {
  const ctx = canvas.getContext('2d');

  let view = null;
  let width = 0;
  let height = 0;
  let gutter = GUTTER_TIERS.at(-1).width;
  let scrollY = 0;
  let contentH = 0;
  let theme = null;
  let layout = [];
  let frame = null;

  const collapsed = new Set();

  // A wide gutter fits the count beside the name; a narrow one gives the name
  // the full width and drops the count onto its own line underneath.
  const countInline = () => gutter >= 130;
  const labelWidth = () => gutter - (countInline() ? 34 : 16);
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
    // Always packed to the widest cap, then trimmed to what fits. First-fit
    // fills row 1 before row 2, so the rows that survive the trim hold exactly
    // what a pack at the smaller cap would have put there - one pack per
    // frame instead of one per candidate height.
    const packed = packLanes(entries, model.order, view, {
      maxRows: MAX_ROWS,
      minWidthPx: MIN_BAR_W,
      laneKey: model.key,
    });
    const caps = rowCaps(packed, model);

    let y = 0;
    const laid = packed.map((lane) => {
      const isCollapsed = collapsed.has(lane.lane);
      const cap = caps.get(lane.lane) ?? MAX_ROWS;
      // A collapsed lane draws every entry into one thin band, so trimming its
      // rows would drop entries it has the room for.
      const rows = isCollapsed ? lane.rows : lane.rows.slice(0, cap);
      const trimmed = isCollapsed
        ? 0
        : lane.rows.slice(cap).reduce((n, row) => n + row.length, 0);
      // A lane is as tall as its bars or its wrapped name, whichever needs more:
      // a three-line name in a two-row lane would otherwise overflow into the
      // lane below.
      const h = laneHeightWith(lane, rows.length, model);
      const out = {
        ...lane,
        rows,
        hidden: lane.hidden + trimmed,
        label: model.labels.get(lane.lane) ?? lane.lane,
        colourKey: model.colours.get(lane.lane) ?? lane.lane,
        collapsed: isCollapsed,
        y,
        h,
        // Counted before the trim: the gutter reports what the lane holds in
        // this window, not what happened to be drawn.
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

  /**
   * The lane name, broken across lines instead of cut off.
   *
   * "Centr…" and "Ameri…" name nothing; at phone width almost every lane
   * truncated to something unreadable. wrapText keeps the name whole and cuts
   * only a single word too wide for the gutter.
   */
  function wrapLabel(text) {
    ctx.font = LANE_FONT;
    return wrapText(text, labelWidth(), LANE_LABEL_LINES,
      (s) => ctx.measureText(s).width);
  }

  /** Vertical room a lane's wrapped name needs, counting its count line. */
  const labelHeights = new Map();
  function labelHeight(laneId, model) {
    const key = `${gutter}|${laneId}`;
    const cached = labelHeights.get(key);
    if (cached !== undefined) return cached;
    const label = model.labels.get(laneId) ?? laneId;
    const h = (wrapLabel(label).length + (countInline() ? 0 : 1)) * LANE_LINE_H;
    labelHeights.set(key, h);
    return h;
  }

  /** Height a lane takes when this many of its rows are shown. */
  function laneHeightWith(lane, rowsShown, model) {
    const bars = collapsed.has(lane.lane)
      ? COLLAPSED_BAR_H
      : Math.max(1, rowsShown) * (BAR_H + BAR_GAP) - BAR_GAP;
    return LANE_PAD_Y * 2 + Math.max(bars, labelHeight(lane.lane, model));
  }

  /** Entries a lane would keep behind "+N more" at this cap. */
  const beyond = (lane, cap) =>
    lane.rows.slice(cap).reduce((n, row) => n + row.length, 0) + lane.hidden;

  /**
   * How many rows to draw, per lane.
   *
   * A phone screen was left with room to spare below the last lane while
   * entries sat behind "+38 more". One more row for every lane does not fit -
   * twelve lanes at three rows need more height than the screen has - so the
   * spare space goes to the lanes hiding the most, a row at a time, until it
   * runs out. Lane heights already vary with how many rows a lane fills, so
   * uneven lanes are not a new thing to look at.
   *
   * Wide screens keep the full cap and scroll as they did.
   */
  function rowCaps(packed, model) {
    const caps = new Map();
    const base = width >= NARROW_PX ? MAX_ROWS : MAX_ROWS_NARROW;
    for (const lane of packed) caps.set(lane.lane, base);
    if (width >= NARROW_PX) return caps;

    const heightAt = (lane, cap) =>
      laneHeightWith(lane, Math.min(lane.rows.length, cap), model);

    let spare = (height - AXIS_H) - packed.reduce(
      (sum, lane) => sum + heightAt(lane, base) + LANE_SEP, 0);
    if (spare <= 0) return caps;

    // Busiest first, so the scarce rows land where they reveal the most.
    const queue = [...packed].sort((a, b) => beyond(b, base) - beyond(a, base));

    // Repeats until nothing more fits: a lane can earn a second extra row
    // while a narrower one still cannot afford its first.
    for (let granted = true; granted && spare > 0;) {
      granted = false;
      for (const lane of queue) {
        const cap = caps.get(lane.lane);
        if (cap >= MAX_ROWS || lane.rows.length <= cap) continue;
        const cost = heightAt(lane, cap + 1) - heightAt(lane, cap);
        if (cost > spare) continue;
        caps.set(lane.lane, cap + 1);
        spare -= cost;
        granted = true;
      }
    }
    return caps;
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

    ctx.font = LANE_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Anchored to the top of the lane, not centred in it. A tall lane - six
    // rows on a desktop - is ~104px, so centring floats the name into the
    // middle of the gutter while the inline count stays pinned near the top,
    // and the two read as unrelated.
    const lines = wrapLabel(lane.label);
    const firstLineY = top + LANE_PAD_Y + LANE_LINE_H / 2;

    ctx.fillStyle = theme.ink;
    let textY = firstLineY;
    for (const line of lines) {
      ctx.fillText(line, 10, textY);
      textY += LANE_LINE_H;
    }

    ctx.fillStyle = theme.inkFaint;
    const count = lane.collapsed ? `${lane.count} ›` : String(lane.count);
    if (countInline()) {
      // Shares the first line's baseline, which is what ties it to the name.
      ctx.textAlign = 'right';
      ctx.fillText(count, gutter - 8, firstLineY);
    } else {
      ctx.fillText(count, 10, textY);
    }

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

    if (hover.onAxis) {
      const prompt = 'Click for this year';
      const padding = 7;
      const boxW = ctx.measureText(prompt).width + padding * 2;
      const bx = Math.min(hover.x + 14, width - boxW - 6);
      ctx.fillStyle = theme.bgRaised;
      ctx.strokeStyle = theme.ruleStrong;
      ctx.beginPath();
      ctx.roundRect(bx + 0.5, AXIS_H + 6.5, boxW, 22, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = theme.inkSoft;
      ctx.textAlign = 'left';
      ctx.fillText(prompt, bx + padding, AXIS_H + 18);
      return;
    }

    // Lane name, and the entry under the cursor when there is one. Below the
    // last lane there is neither, and an unfiltered list would still hold one
    // empty string - which drew an empty box hanging off the crosshair.
    const lines = [];
    if (hover.item) {
      const e = hover.item.entry;
      lines.push(e.title, e.sMin === e.eMax
        ? formatYear(e.sMin)
        : `${formatYear(e.sMin)} \u2013 ${formatYear(e.eMax)}`);
    }
    if (hover.laneLabel) lines.push(hover.laneLabel);
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
    gutter = GUTTER_TIERS.find((t) => width <= t.upTo).width;
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
      const onPlot = cx >= gutter;
      canvas.style.cursor = onPlot ? 'pointer' : 'default';
      hover = onPlot
        ? { x: cx, y: cy, year: view.unproject(cx - gutter), laneLabel: '', item: null,
            onAxis: true }
        : null;
      schedule();
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

    if (event.clientY - rect.top < AXIS_H) {
      axisClick(event);
      return;
    }

    const hit = hitTest(event.clientX, event.clientY);
    onSelect?.(hit ? hit.entry : null);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function axisClick(event) {
    const rect = canvas.getBoundingClientRect();
    const cy = event.clientY - rect.top;
    const cx = event.clientX - rect.left;
    if (cy >= AXIS_H || cx < gutter) return;
    onPickYear?.(view.unproject(cx - gutter));
  }

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
