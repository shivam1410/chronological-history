/**
 * The year slice: everything underway in a single year, grouped by region.
 *
 * The timeline answers "what overlapped?" by eye. This answers it as a list,
 * and adds the two things a bar cannot show - how far into its span something
 * was, and how old a person happened to be.
 */

import { activeIn, groupByLane, positionIn } from './slice.js';
import { formatYear } from './format.js';

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

  function close() {
    if (!node) return;
    node.remove();
    node = null;
    shownYear = null;
    onClose?.();
  }

  function span(entry) {
    return entry.sMin === entry.eMax
      ? formatYear(entry.sMin)
      : `${formatYear(entry.sMin)} – ${formatYear(entry.eMax)}`;
  }

  function render(year) {
    const hits = activeIn(entries, year);
    const groups = groupByLane(hits, laneOrder);

    const panel = el('section', 'yearview');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'yearview-title');

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
    // Goes to the timeline AT this year. Closing with the x just returns to
    // whatever window the timeline already had, which is a different thing.
    const toTimeline = el('button', 'yearview__link', 'View on timeline');
    toTimeline.type = 'button';
    toTimeline.addEventListener('click', () => onViewOnTimeline?.(year));
    const closeBtn = el('button', 'yearview__close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close the year view');
    closeBtn.addEventListener('click', close);
    actions.append(toTimeline, closeBtn);

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
      node.querySelector('.yearview__close')?.focus();
    },

    close,
  };
}
