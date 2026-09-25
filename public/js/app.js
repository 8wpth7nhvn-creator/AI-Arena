// App shell: boot, routing and the shared top bar.

import { api } from './api.js';
import { state } from './state.js';
import { h, mount } from './ui/dom.js';
import { levelBadge, xpBar } from './ui/components.js';
import { renderHome } from './screens/home.js';
import { renderSubjects } from './screens/subjects.js';
import { renderCharacters } from './screens/characters.js';
import { renderArena } from './screens/arena.js';
import { renderSummary } from './screens/summary.js';

const ROUTES = {
  '': renderHome,
  subjects: renderSubjects,
  characters: renderCharacters,
  arena: renderArena,
  summary: renderSummary,
};

const app = document.getElementById('app');
let cleanup = null;

export function navigate(route) {
  const target = `#/${route}`;
  if (location.hash === target) render();
  else location.hash = target;
}

export function updatePlayerChip(player = state.player, { from } = {}) {
  if (!player) return;
  state.player = player;
  const chip = document.getElementById('player-chip');
  chip.hidden = false;
  mount(chip, levelBadge(player.level, { small: true }), xpBar(player, { compact: true, from }));
}

function render() {
  cleanup?.();
  cleanup = null;
  const route = location.hash.replace(/^#\/?/, '').split('?')[0];
  const screen = ROUTES[route] || renderHome;
  const root = h('div', { class: 'screen' });
  mount(app, root);
  window.scrollTo(0, 0);
  cleanup = screen(root, { navigate }) || null;
  app.focus({ preventScroll: true });
}

async function boot() {
  try {
    const [config, content] = await Promise.all([api.config(), api.content()]);
    state.config = config;
    state.content = content;
    const { player } = await api.player(state.userId);
    state.userId = player.id;
    updatePlayerChip(player);

    const badge = document.getElementById('mode-badge');
    badge.hidden = false;
    badge.textContent = config.mode === 'live' ? '● LIVE AI' : 'DEMO MODE';
    badge.className = `mode-badge${config.mode === 'live' ? ' live' : ''}`;
    badge.title =
      config.mode === 'live'
        ? `Opponent powered by ${config.model}`
        : config.hosted
          ? 'Demo opponent running entirely in your browser. Your progress is saved on this device.'
          : 'Offline demo opponent. Set ANTHROPIC_API_KEY on the server to play against real AI.';
  } catch (err) {
    mount(
      app,
      h(
        'div',
        { class: 'boot', role: 'alert' },
        h('p', {}, 'Could not reach the arena server.'),
        h('p', { style: { marginTop: '8px' } }, err.message),
        h('div', { class: 'btn-row', style: { marginTop: '16px' } }, h('button', { class: 'btn btn-primary', onclick: boot }, 'Retry')),
      ),
    );
    return;
  }
  window.addEventListener('hashchange', render);
  render();
}

boot();
