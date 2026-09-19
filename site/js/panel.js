/**
 * Detail panel for a single entry.
 *
 * Opens immediately with what the spine already knows - title, dates, lane -
 * and fills in the prose when the era bundle resolves. Waiting for the fetch
 * before showing anything would make every click feel slow for data we already
 * have in memory.
 */

const FOCUSABLE = 'a[href], button, [tabindex]:not([tabindex="-1"])';

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

export function createPanel(root, { onClose, onNavigate } = {}) {
  let node = null;
  let invoker = null;
  let openId = null;

  function close() {
    if (!node) return;
    node.remove();
    node = null;
    openId = null;
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
