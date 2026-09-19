import { loadIndex } from './store.js';
import { createTimeline } from './timeline.js';
import { formatYear } from './format.js';

const stage = document.querySelector('#stage');
const meta = document.querySelector('#meta');

function showError(error) {
  stage.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'error';
  box.innerHTML = `
    <h2>Could not load the timeline data</h2>
    <p>The site needs to be served over http. Opening index.html directly
       from the filesystem will not work.</p>
    <p><code></code></p>
    <button type="button">Retry</button>`;
  box.querySelector('code').textContent = error.url
    ? `${error.message} — ${error.cause?.message ?? ''}`
    : String(error);
  box.querySelector('button').addEventListener('click', () => start());
  stage.append(box);
}

async function start() {
  stage.innerHTML = '<canvas id="canvas" class="timeline" tabindex="0"></canvas>'
    + '<p class="hint">scroll to zoom · drag to pan</p>';
  try {
    const { meta: info, entries } = await loadIndex();

    // createTimeline fires onViewChange during construction, so this closure
    // must not reach for the timeline binding it is being passed to.
    const describe = (view) =>
      `${formatYear(Math.round(view.from))} to ${formatYear(Math.round(view.to))}`;

    const timeline = createTimeline(document.querySelector('#canvas'), {
      entries,
      onViewChange: (view) => {
        meta.textContent = `${entries.length} entries · ${describe(view)}`;
      },
    });
    window.__timeline = { timeline, entries, info };
  } catch (error) {
    showError(error);
  }
}

start();
