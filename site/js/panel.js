/**
 * Detail panel for a single entry.
 *
 * Opens immediately with what the spine already knows - title, dates, lane -
 * and fills in the prose when the era bundle resolves. Waiting for the fetch
 * before showing anything would make every click feel slow for data we already
 * have in memory.
 */

import { linearView, panWindow, ticksFor, windowFor } from './context.js';
import { packLane } from './layout.js';
import { formatYear } from './format.js';

const FOCUSABLE = 'a[href], button, [tabindex]:not([tabindex="-1"])';

/** Strip geometry. Widths are percentages, so it reflows with the card. */
const STRIP_ROWS = 4;
const STRIP_MIN_W = 2;
const STRIP_GAP = 0.8;
const STRIP_BAR_PX = 26;
const STRIP_GAP_PX = 4;

const KIND_LABELS = {
  person: 'Person', work: 'Text', polity: 'Polity', event: 'Event',
  period: 'Period', geological: 'Geological', biological: 'Biological',
  structure: 'Structure', movement: 'Movement', technology: 'Technology',
};

const CONFIDENCE_NOTE = {
  medium: 'Dates are approximate.',
  contested: 'Scholars disagree about these dates.',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function chipRow(labels, { onPick } = {}) {
  const row = el('div', 'panel__chips');
  for (const { id, label } of labels) {
    const chip = onPick ? el('button', 'panel__chip', label) : el('span', 'panel__chip', label);
    if (onPick) {
      chip.type = 'button';
      chip.addEventListener('click', () => onPick(id));
    }
    row.append(chip);
  }
  return row;
}

export function createPanel(root, {
  onClose, onNavigate, contemporaries, laneNeighbours,
} = {}) {
  let node = null;
  let invoker = null;
  let openId = null;

  function close() {
    if (!node) return;
    node.remove();
    node = null;
    openId = null;
    delete document.body.dataset.panel;
    const returnTo = invoker;
    invoker = null;
    returnTo?.focus?.();
    onClose?.();
  }

  function trapFocus(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab' || !node) return;
    const focusable = [...node.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function shell(entry) {
    const panel = el('aside', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'panel-title');
    panel.addEventListener('keydown', trapFocus);

    const head = el('header', 'panel__head');
    const close_ = el('button', 'panel__close', '×');
    close_.type = 'button';
    close_.setAttribute('aria-label', 'Close');
    close_.addEventListener('click', close);

    const title = el('h2', 'panel__title', entry.title);
    title.id = 'panel-title';

    const meta = el('p', 'panel__meta');
    meta.append(el('span', 'panel__badge', KIND_LABELS[entry.kind] ?? entry.kind));
    const dates = el('span', 'panel__dates', '…');
    meta.append(dates);

    head.append(close_, title, meta);
    panel.append(head);

    const body = el('div', 'panel__body');
    panel.append(body);
    return { panel, body, dates };
  }

  function fill(body, dates, entry, detail) {
    dates.textContent = detail.display ?? '';
    body.replaceChildren();

    // Most of these are CC BY-SA, which requires the credit and the licence to
    // travel with the picture. Showing the image without them is a breach, so
    // the figure is built as one unit.
    if (detail.image?.url) {
      const figure = el('figure', 'panel__figure');
      const img = document.createElement('img');
      img.src = detail.image.url;
      img.alt = entry.title;
      // Not lazy: a freshly opened panel always has the image above the fold,
      // and deferring it just makes the panel look broken for a moment.
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => figure.remove());
      figure.append(img);

      const caption = el('figcaption', 'panel__credit');
      const link = el('a', null, detail.image.credit || 'Wikimedia Commons');
      link.href = detail.image.source;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      caption.append(link, document.createTextNode(` \u00b7 ${detail.image.license}`));
      figure.append(caption);
      body.append(figure);
    }

    if (detail.confidence && CONFIDENCE_NOTE[detail.confidence]) {
      const flag = el('p', `panel__flag panel__flag--${detail.confidence}`,
        CONFIDENCE_NOTE[detail.confidence]);
      body.append(flag);
    }

    if (detail.summary) body.append(el('p', 'panel__summary', detail.summary));
    if (detail.significance) body.append(el('p', 'panel__prose', detail.significance));

    if (detail.note) {
      const note = el('div', 'panel__note');
      note.append(el('h3', 'panel__h3', 'On the dating'));
      note.append(el('p', null, detail.note));
      body.append(note);
    }

    const tags = [
      ...(detail.regions ?? []).map((id) => ({ id, label: id.replace(/-/g, ' ') })),
      ...(detail.categories ?? []).map((id) => ({ id, label: id.replace(/-/g, ' ') })),
    ];
    if (tags.length) body.append(chipRow(tags));

    // The entry's own lane, drawn rather than listed: what a reader wants here
    // is the shape - whether this thing followed that one or sat inside it -
    // which a column of dates cannot show.
    const neighbours = laneNeighbours?.(entry) ?? [];
    if (neighbours.length) {
      body.append(el('h3', 'panel__h3', 'In this lane'));
      body.append(laneStrip(entry, neighbours, onNavigate));
    }

    // What else was going on. This is the question the whole site exists to
    // answer, so it sits above the curated links rather than under them, and
    // it is computed from the timeline rather than authored per entry.
    const alsoRunning = contemporaries?.(entry) ?? [];
    if (alsoRunning.length) {
      body.append(el('h3', 'panel__h3', 'At the same time'));
      const list = el('ul', 'panel__same');
      for (const other of alsoRunning) {
        const item = el('li', 'panel__same-item');
        const button = el('button', 'panel__same-button');
        button.type = 'button';
        button.append(el('span', 'panel__same-title', other.title));
        button.append(el('span', 'panel__same-where', other.laneLabel));
        button.append(el('span', 'panel__same-when', other.when));
        button.addEventListener('click', () => onNavigate?.(other.id));
        item.append(button);
        list.append(item);
      }
      body.append(list);
    }

    if (detail.related?.length) {
      body.append(el('h3', 'panel__h3', 'Related'));
      body.append(chipRow(
        detail.related.map((id) => ({ id, label: id.replace(/-/g, ' ') })),
        { onPick: (id) => onNavigate?.(id) },
      ));
    }

    const links = [
      ...(detail.texts ?? []).map((t) => ({ ...t, group: 'Read the text' })),
      ...(detail.sources ?? []).map((s) => ({ ...s, group: 'Sources' })),
    ];
    for (const group of ['Read the text', 'Sources']) {
      const inGroup = links.filter((l) => l.group === group);
      if (!inGroup.length) continue;
      body.append(el('h3', 'panel__h3', group));
      const list = el('ul', 'panel__links');
      for (const link of inGroup) {
        const item = el('li');
        const anchor = el('a', null, link.title);
        anchor.href = link.url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        item.append(anchor);
        list.append(item);
      }
      body.append(list);
    }

    if (detail.wikidata) {
      const anchor = el('a', 'panel__wikidata', `Wikidata ${detail.wikidata}`);
      anchor.href = `https://www.wikidata.org/wiki/${detail.wikidata}`;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      body.append(anchor);
    }
  }

  return {
    get openId() { return openId; },

    open(entry, loadDetail, { returnFocusTo = null } = {}) {
      const wasOpen = node !== null;
      if (wasOpen) node.remove();
      else invoker = returnFocusTo ?? document.activeElement;

      const { panel, body, dates } = shell(entry);
      body.append(el('p', 'panel__shimmer', 'Loading details…'));
      root.append(panel);
      node = panel;
      openId = entry.id;
      // Marks the document so the phone layout can give the card the minimap's
      // row. The minimap is a sibling of the stage this panel lives in, so it
      // cannot be covered from here.
      document.body.dataset.panel = 'open';
      panel.querySelector('.panel__close').focus();

      loadDetail()
        .then((detail) => {
          if (openId !== entry.id) return; // superseded by another click
          fill(body, dates, entry, detail);
        })
        .catch(() => {
          if (openId !== entry.id) return;
          body.replaceChildren(el('p', 'panel__error',
            'Details unavailable — the era bundle could not be loaded.'));
        });
    },

    close,
  };
}

/**
 * A small linear chart of one entry among its lane neighbours.
 *
 * Positions are percentages, so the strip reflows between a full-width phone
 * card and a 380px desktop drawer without measuring anything or watching for
 * resizes. packLane is handed a 100-unit view for the same reason: its minimum
 * width and gap then read as percent, which is what the CSS consumes.
 */
function laneStrip(entry, neighbours, onNavigate) {
  const strip = el('div', 'strip');
  let window_ = windowFor(entry);

  const head = el('div', 'strip__head');
  const earlier = el('button', 'strip__step', '\u2190 Earlier');
  const later = el('button', 'strip__step', 'Later \u2192');
  earlier.type = 'button';
  later.type = 'button';
  head.append(earlier, later);

  const axis = el('div', 'strip__axis');
  const rows = el('div', 'strip__rows');
  strip.append(head, axis, rows);

  function render() {
    const view = linearView(window_.from, window_.to, 100);

    axis.replaceChildren();
    for (const year of ticksFor(window_.from, window_.to)) {
      const tick = el('span', 'strip__tick', formatYear(year));
      const at = view.project(year);
      tick.style.left = `${at}%`;
      // Centred labels overhang at the ends, where there is no room to
      // overhang into, so the outermost ones align to their own edge instead.
      if (at < 6) tick.style.transform = 'none';
      else if (at > 94) tick.style.transform = 'translateX(-100%)';
      axis.append(tick);
    }

    const packed = packLane([entry, ...neighbours], view, {
      maxRows: STRIP_ROWS,
      minWidthPx: STRIP_MIN_W,
      gapPx: STRIP_GAP,
    });

    rows.replaceChildren();
    rows.dataset.rows = String(Math.max(1, packed.rows.length));
    packed.rows.forEach((row, r) => {
      for (const item of row) {
        const isSelf = item.entry.id === entry.id;
        const bar = el('button', 'strip__bar');
        bar.type = 'button';
        if (isSelf) bar.dataset.self = 'true';
        // Clamped to the window. A neighbour that starts before it has a
        // negative x0, and its label - pinned to the bar's own left edge -
        // was being laid out off-screen, leaving a wide blank capsule. The
        // canvas renderer clamps for the same reason.
        const left = Math.max(0, item.x0);
        const width = Math.max(0, Math.min(100, item.x0 + item.w) - left);
        bar.style.left = `${left}%`;
        bar.style.width = `${width}%`;
        // Too narrow to hold a name: show a plain capsule and let the tooltip
        // and the tap carry it, rather than a letter and a half of the title.
        if (width < 9) bar.dataset.narrow = 'true';
        bar.style.top = `${r * (STRIP_BAR_PX + STRIP_GAP_PX)}px`;
        bar.append(el('span', 'strip__bar-title', item.entry.title));
        // The dates go in the title attribute as well as the bar, because a
        // short bar shows neither its name nor its years.
        const when = item.entry.sMin === item.entry.eMax
          ? formatYear(item.entry.sMin)
          : `${formatYear(item.entry.sMin)}\u2013${formatYear(item.entry.eMax)}`;
        bar.title = `${item.entry.title}, ${when}`;
        if (!isSelf) bar.addEventListener('click', () => onNavigate?.(item.entry.id));
        else bar.disabled = true;
        rows.append(bar);
      }
    });
  }

  const step = (fraction) => {
    window_ = panWindow(window_, fraction);
    render();
  };
  earlier.addEventListener('click', () => step(-0.4));
  later.addEventListener('click', () => step(0.4));

  render();
  return strip;
}
