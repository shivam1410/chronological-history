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

/*
 * On a phone the lanes are separated by space, not a hairline. A 1px rule
 * between a lane's last bars and the next lane's name strip left them reading
 * as one continuous block; the gap gives each lane a visible start.
 */
const PHONE_LANE_SEP = 10;
const MIN_BAR_W = 3;
const MAX_ROWS = 6;
const COLLAPSED_BAR_H = 5;

/** Padding added to each target's hit box, so a 3px bar is still clickable. */
const HIT_PAD = 10;

/** Travel before a touch drag commits to panning time or scrolling lanes. */
const AXIS_LOCK_PX = 12;

// The lane gutter has to stay legible without eating a phone screen. Below
// 560px it stops being a column at all: a 96px gutter was 26% of a 375px
// screen, leaving 279px for 4.5 billion years. The name moves to a strip above
// each lane instead, and the chart gets the whole width.
const GUTTER_TIERS = [
  { upTo: 560, width: 0 },
  { upTo: 760, width: 112 },
  { upTo: Infinity, width: 150 },
];

/** Height of the name strip drawn above a lane when there is no gutter. */
const LANE_HEAD_H = 24;

/*
 * A phone gets taller rows and larger type than a desktop, not smaller.
 * Everything here was sized for a gutter layout on a wide screen and then
 * inherited by the phone, where 11px text on a 14px bar reads as fine print.
 * Rows no longer shrink to fit the screen either - there are more of them than
 * fit, and the chart scrolls.
 */
const PHONE_BAR_H = 20;
const PHONE_ROWS = 3;
const PHONE_LANE_FONT = '13px ui-sans-serif, system-ui, sans-serif';
const PHONE_LABEL_FONT = '12.5px ui-sans-serif, system-ui, sans-serif';
const AXIS_FONT = '11px ui-sans-serif, system-ui, sans-serif';
const PHONE_AXIS_FONT = '12.5px ui-sans-serif, system-ui, sans-serif';

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

  // No gutter means the lane name sits on its own strip above the bars.
  const labelsAbove = () => gutter === 0;
  const laneHead = () => (labelsAbove() ? LANE_HEAD_H : 0);
  const barH = () => (labelsAbove() ? PHONE_BAR_H : BAR_H);
  const laneFont = () => (labelsAbove() ? PHONE_LANE_FONT : LANE_FONT);
  const labelFont = () => (labelsAbove() ? PHONE_LABEL_FONT : LANE_FONT);
  const axisFont = () => (labelsAbove() ? PHONE_AXIS_FONT : AXIS_FONT);
  const laneSep = () => (labelsAbove() ? PHONE_LANE_SEP : LANE_SEP);
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
    const caps = rowCaps(packed);

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
      y += h + laneSep();
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

    ctx.font = axisFont();
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

  function drawBar(item, y, colour, h = barH()) {
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
    ctx.font = laneFont();
    return wrapText(text, labelWidth(), LANE_LABEL_LINES,
      (s) => ctx.measureText(s).width);
  }

  /** Vertical room a lane's wrapped name needs, counting its count line. */
  const labelHeights = new Map();
  function labelHeight(laneId, model) {
    // Above the lane the name has the full width and its own strip, which
    // laneHeightWith adds separately - it asks for no room beside the bars.
    if (labelsAbove()) return 0;
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
      : Math.max(1, rowsShown) * (barH() + BAR_GAP) - BAR_GAP;
    return laneHead() + LANE_PAD_Y * 2 + Math.max(bars, labelHeight(lane.lane, model));
  }

  /**
   * How many rows to draw, per lane.
   *
   * A fixed number, not a number chosen to make everything fit. Squeezing
   * twelve lanes onto one screen meant most of them got a single row while
   * entries piled up behind "+N more"; there are simply more rows than a phone
   * has height for, so the chart scrolls instead and each row gets its proper
   * size. Vertical drag scrolls it, and with the axis lock a swipe up does
   * only that.
   */
  function rowCaps(packed) {
    const cap = width >= NARROW_PX
      ? MAX_ROWS
      : (labelsAbove() ? PHONE_ROWS : MAX_ROWS_NARROW);
    return new Map(packed.map((lane) => [lane.lane, cap]));
  }

  function drawLane(lane) {
    const top = AXIS_H + lane.y - scrollY;
    if (top > height || top + lane.h < AXIS_H) return;

    const colour = laneColour(lane.colourKey);

    // Lane band
    ctx.fillStyle = theme.bg;
    ctx.fillRect(gutter, top, width - gutter, lane.h);

    ctx.font = laneFont();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    if (labelsAbove()) {
      // A strip across the top of the lane. The name has the full width here,
      // so it never wraps and never truncates, and the count sits right after
      // it rather than across a column from it.
      ctx.fillStyle = theme.bgRaised;
      ctx.fillRect(0, top, width, LANE_HEAD_H);
      ctx.fillStyle = colour;
      ctx.fillRect(0, top, 3, LANE_HEAD_H);

      const midY = top + LANE_HEAD_H / 2;
      ctx.fillStyle = theme.ink;
      ctx.fillText(lane.label, 8, midY);
      ctx.fillStyle = theme.inkFaint;
      ctx.fillText(
        lane.collapsed ? `${lane.count} \u203a` : String(lane.count),
        8 + ctx.measureText(lane.label).width + 6, midY);

      drawLaneBody(lane, top, colour);
      return;
    }

    // Gutter header
    ctx.fillStyle = theme.bgRaised;
    ctx.fillRect(0, top, gutter, lane.h);
    ctx.fillStyle = colour;
    ctx.fillRect(0, top, 3, lane.h);

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

    drawLaneBody(lane, top, colour);
  }

  /** Bars, labels and the overflow badge - everything below the lane name. */
  function drawLaneBody(lane, top, colour) {
    // Entry labels and the overflow badge, set explicitly rather than
    // inheriting whatever the lane name happened to leave behind.
    ctx.font = labelFont();

    // Separator. Where lanes are parted by a gap the rule has nothing left to
    // do, and would hang in the middle of that gap.
    if (!labelsAbove()) {
      ctx.strokeStyle = theme.rule;
      ctx.beginPath();
      ctx.moveTo(0, top + lane.h + 0.5);
      ctx.lineTo(width, top + lane.h + 0.5);
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(gutter, Math.max(top, AXIS_H), width - gutter,
      Math.min(lane.h, top + lane.h - AXIS_H));
    ctx.clip();
    // layout.js works in timeline-area coordinates, where 0 is view.from. The
    // gutter offset is applied once, here, so bars land under their own axis.
    ctx.translate(gutter, 0);

    if (lane.collapsed) {
      const y = top + laneHead() + LANE_PAD_Y;
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
      const y = top + laneHead() + LANE_PAD_Y + r * (barH() + BAR_GAP);
      const mid = y + barH() / 2;
      row.forEach((item, i) => {
        if (item.point) drawPoint(item, mid, colour);
        else drawBar(item, y, colour);
        if (item.entry.id === selectedId) {
          ctx.strokeStyle = theme.ink;
          ctx.lineWidth = 2;
          ctx.strokeRect(item.x0 - 1.5, y - 1.5, item.w + 3, barH() + 3);
          ctx.lineWidth = 1;
        }
        drawLabel(item, row[i + 1], mid, minImportance);
      });
    });

    if (lane.hidden > 0) {
      const text = `+${lane.hidden} more`;
      const w = ctx.measureText(text).width + 10;
      const y = top + lane.h - LANE_PAD_Y - barH();
      const right = width - gutter;
      ctx.fillStyle = theme.bgSunken;
      ctx.fillRect(right - w - 6, y, w, barH());
      ctx.fillStyle = theme.inkSoft;
      ctx.textAlign = 'right';
      ctx.fillText(text, right - 11, y + barH() / 2);
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

    ctx.font = axisFont();
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

    // Gutter edge, drawn last so lane bands cannot bleed over it. With no
    // gutter there is no edge - and this must not skip drawHover below.
    if (gutter > 0) {
      ctx.strokeStyle = theme.ruleStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gutter + 0.5, 0);
      ctx.lineTo(gutter + 0.5, height);
      ctx.stroke();
    }

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

    // A negative index - a tap on the name strip - floors below zero and finds
    // no row, which is what should happen: that strip toggles the lane.
    const row = lane.rows[
      Math.floor((y - lane.y - laneHead() - LANE_PAD_Y) / (barH() + BAR_GAP))];
    return row ? hitRow(row, x, HIT_PAD) : null;
  }

  /** The lane whose name strip is under this point, if any. */
  function laneHeadAt(clientX, clientY) {
    if (!labelsAbove()) return null;
    const rect = canvas.getBoundingClientRect();
    if (clientY - rect.top < AXIS_H) return null;
    const lane = laneAt(clientY);
    if (!lane) return null;
    const y = clientY - rect.top - AXIS_H + scrollY;
    return y - lane.y < LANE_HEAD_H ? lane : null;
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

  /**
   * Live pointers, so two fingers can be told from one.
   *
   * Zooming had no touch gesture at all: a phone could drag to pan, but the
   * only ways to change the span were the era tabs and the date filter. On a
   * timeline covering 4.5 billion years that is the central interaction, so
   * pinch belongs here.
   */
  const pointers = new Map();
  let pinch = null;

  /** Separation of the two fingers, and the plot-space point between them. */
  function pinchState() {
    const [a, b] = [...pointers.values()];
    const rect = canvas.getBoundingClientRect();
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2 - rect.left - gutter,
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Capture is an optimisation, not a precondition. It throws if the pointer
    // is already gone, and a throw here used to abandon the rest of this
    // handler - so the gesture was never registered at all.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to do: the gesture still tracks through the events below.
    }

    if (pointers.size === 2) {
      // A second finger ends the drag rather than fighting it, or the view
      // lurches sideways as the hands settle.
      dragging = null;
      pinch = pinchState();
      return;
    }
    if (pointers.size > 2) return;

    dragging = {
      x: event.clientX, y: event.clientY, moved: false,
      touch: event.pointerType === 'touch',
      totalX: 0, totalY: 0, axis: null,
    };
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

    // The name strip took the gutter's job of toggling a lane.
    if (laneHeadAt(event.clientX, event.clientY)) {
      canvas.style.cursor = 'pointer';
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
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinch && pointers.size >= 2) {
      const next = pinchState();
      // Fingers apart is a shorter span, so the factor is the ratio inverted.
      // Guard the degenerate case: two pointers at the same point give zero.
      if (pinch.distance > 0 && next.distance > 0) {
        const factor = pinch.distance / next.distance;
        if (Math.abs(1 - factor) > 0.002) {
          view = view.zoomAbout(next.midX, factor);
          schedule();
          onViewChange?.(view);
        }
      }
      pinch = next;
      return;
    }

    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (dx === 0 && dy === 0) return;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragging.moved = true;
    dragging.x = event.clientX;
    dragging.y = event.clientY;

    // A finger is not a mouse. A swipe meant for one axis always carries some
    // of the other, so panning through time and scrolling the lanes happened
    // at once and neither landed where it was aimed. The first decisive
    // movement picks the axis and the gesture keeps it, which is what the
    // wheel handler already does for a trackpad.
    dragging.totalX += Math.abs(dx);
    dragging.totalY += Math.abs(dy);
    if (dragging.touch && !dragging.axis
        && dragging.totalX + dragging.totalY > AXIS_LOCK_PX) {
      dragging.axis = dragging.totalX >= dragging.totalY ? 'x' : 'y';
    }

    // Until the axis is settled a touch drag moves nothing. The scale is
    // logarithmic, so a stray four pixels at the deep-time end is millions of
    // years - applying the wobble before the gesture has declared itself is
    // not harmless, and it was enough to shift 25.3 Ma to 30.3 Ma on a swipe
    // meant only to scroll.
    const undecided = dragging.touch && !dragging.axis;
    const panBy = undecided || dragging.axis === 'y' ? 0 : dx;
    const scrollBy = undecided || dragging.axis === 'x' ? 0 : dy;
    if (panBy) view = view.pan(-panBy);
    if (scrollBy) scrollY -= scrollBy;
    schedule();
    if (panBy) onViewChange?.(view);
  });

  const endDrag = (event) => {
    pointers.delete(event.pointerId);
    canvas.releasePointerCapture?.(event.pointerId);

    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1 && !dragging) {
      // One finger lifted from a pinch. Carry on as a drag from where the
      // other finger actually is, so the view does not jump to meet it, and
      // count it as already moved so the lift is not read as a tap.
      const [remaining] = [...pointers.values()];
      dragging = {
        x: remaining.x, y: remaining.y, moved: true, touch: true,
        totalX: 0, totalY: 0, axis: null,
      };
      return;
    }

    if (!dragging) return;
    const wasDrag = dragging.moved;
    dragging = null;
    if (wasDrag) return;

    // A click in the gutter - or, with no gutter, on the lane's name strip -
    // toggles that lane.
    const rect = canvas.getBoundingClientRect();
    const headLane = laneHeadAt(event.clientX, event.clientY);
    if (event.clientX - rect.left < gutter || headLane) {
      const lane = headLane ?? laneAt(event.clientY);
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
