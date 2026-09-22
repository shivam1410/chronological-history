/**
 * The year slice: everything underway in a single year, grouped by region.
 *
 * The timeline answers "what overlapped?" by eye. This answers it as a list,
 * and adds the two things a bar cannot show - how far into its span something
 * was, and how old a person happened to be.
 */

import { activeIn, groupByLane, positionIn } from './slice.js';
import { astro, formatYear } from './format.js';

const STEPS = [
  { label: '◂ 100', delta: -100 },
  { label: '◂ 10', delta: -10 },
  { label: '◂ 1', delta: -1 },
  { label: '1 ▸', delta: 1 },
  { label: '10 ▸', delta: 10 },
  { label: '100 ▸', delta: 100 },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createYearView(root, {
  entries, lanes, onStep, onClose, onPick, onViewOnTimeline,
}) {
  const laneOrder = lanes.map((lane) => lane.id);
  const laneLabel = new Map(lanes.map((lane) => [lane.id, lane.label]));
  let node = null;
  let shownYear = null;

  /**
   * @param {{silent?: boolean}} options  silent skips onClose, for a caller
   *   that is already navigating somewhere specific. onClose exists so the
   *   close button can put the reader back on the timeline they left; when
   *   the route itself changed, that restore would undo the new route.
   */
  function close({ silent = false } = {}) {
    if (!node) return;
    node.remove();
    node = null;
    shownYear = null;
    delete document.body.dataset.yearView;
    if (!silent) onClose?.();
  }

  function span(entry) {
    return entry.sMin === entry.eMax
      ? formatYear(entry.sMin)
      : `${formatYear(entry.sMin)} – ${formatYear(entry.eMax)}`;
  }

  /*
   * How far through its own span this year falls, as a fraction, or null when
   * a bar would say nothing.
   *
   * "year 217 of 235" and "year 82 of 276" are the Safavids at 92% and the
   * Qing at 30% - one empire eighteen years from collapse and one a third of
   * the way in - and telling them apart from the text alone is arithmetic.
   * The rule under each row is that comparison made visible.
   *
   * Two cases get nothing. An entry with no span has no progress to show. And
   * an entry whose span dwarfs recorded history - Homo sapiens, the Himalayan
   * orogeny - computes to 100% and would do so on every year anyone can look
   * up, so a full bar there is decoration rather than information.
   */
  const DEEP_SPAN = 100_000;

  function progress(entry, year) {
    const span_ = astro(entry.eMax) - astro(entry.sMin);
    if (span_ <= 0 || span_ > DEEP_SPAN) return null;
    const through = (astro(year) - astro(entry.sMin)) / span_;
    return Math.min(1, Math.max(0, through));
  }

  function render(year) {
    const hits = activeIn(entries, year);
    const groups = groupByLane(hits, laneOrder);

    const panel = el('section', 'yearview');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'yearview-title');
    // Focusable so the dialog itself can take focus when it opens, now that
    // there is no close button to put it on.
    panel.tabIndex = -1;
    // Escape keeps what the close button did - back to the window you left,
    // which is not where "View on timeline" goes. Without it the year view
    // has no pointer-free exit.
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    });

    const head = el('header', 'yearview__head');
    const title = el('h2', 'yearview__year', formatYear(year));
    title.id = 'yearview-title';

    const count = el('p', 'yearview__count',
      hits.length === 1 ? '1 entry' : `${hits.length} entries`);

    const steps = el('div', 'yearview__steps');
    for (const { label, delta } of STEPS) {
      const button = el('button', 'yearview__step', label);
      button.type = 'button';
      // There is no year zero, so stepping across the seam skips it.
      const target = year + delta;
      button.addEventListener('click', () =>
        onStep?.(target === 0 ? (delta > 0 ? 1 : -1) : target));
      steps.append(button);
    }

    const actions = el('div', 'yearview__actions');
    // The only button out, and it goes to the timeline AT this year. Escape
    // still returns to the window the timeline already had, which is a
    // different destination.
    const toTimeline = el('button', 'yearview__link', 'View on timeline');
    toTimeline.type = 'button';
    toTimeline.addEventListener('click', () => onViewOnTimeline?.(year));
    actions.append(toTimeline);

    head.append(title, count, steps, actions);
    panel.append(head);

    const body = el('div', 'yearview__body');
    panel.append(body);

    if (!groups.length) {
      body.append(el('p', 'yearview__empty',
        `Nothing in the dataset was underway in ${formatYear(year)}.`));
    }

    for (const group of groups) {
      const section = el('section', 'yearview__lane');
      section.append(el('h3', 'yearview__laneName',
        laneLabel.get(group.lane) ?? group.lane));

      const list = el('ul', 'yearview__list');
      for (const { entry, boundary } of group.hits) {
        const item = el('li', 'yearview__item');
        if (boundary) item.dataset.boundary = 'true';

        const name = el('button', 'yearview__name', entry.title);
        name.type = 'button';
        name.addEventListener('click', () => onPick?.(entry));

        // Order matters for the stacked mobile layout: title, then span, then
        // position, so the last two read as one meta line beneath the name.
        item.append(name, el('span', 'yearview__span', span(entry)));
        item.append(el('span',
          `yearview__where${boundary ? ' yearview__where--now' : ''}`,
          positionIn(entry, year)));

        const through = progress(entry, year);
        if (through !== null) {
          const track = el('span', 'yearview__track');
          const done = el('span', 'yearview__done');
          done.style.width = `${(through * 100).toFixed(1)}%`;
          track.append(done);
          item.append(track);
        }
        list.append(item);
      }
      section.append(list);
      body.append(section);
    }

    return panel;
  }

  return {
    get year() { return shownYear; },

    show(year) {
      const next = render(year);
      if (node) node.replaceWith(next);
      else root.append(next);
      node = next;
      shownYear = year;
      // Marks the whole document, because what it hides - the minimap - is a
      // sibling of the stage this view lives in. A single year has no window
      // to place on a 4.5-billion-year strip, so the minimap says nothing.
      document.body.dataset.yearView = 'true';
      node.focus();
    },

    close,
  };
}
