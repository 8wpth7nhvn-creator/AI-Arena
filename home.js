import { h, mount } from '../ui/dom.js';
import { levelBadge, xpBar, hearts } from '../ui/components.js';
import { state } from '../state.js';

const LOOP = [
  { icon: '🧠', title: 'THINK', text: 'Read the claim. Find the flaw.' },
  { icon: '🛡️', title: 'DEFEND', text: 'Explain why and back it up.' },
  { icon: '🔄', title: 'ADAPT', text: 'Answer counterarguments.' },
  { icon: '⚔️', title: 'DEFEAT', text: 'Break the AI\'s argument.' },
  { icon: '🏆', title: 'LEARN', text: 'Earn XP for real understanding.' },
];

export function renderHome(root, { navigate }) {
  const p = state.player;
  const resumable = p?.activeSessionId && p.activeSessionId === state.sessionId;

  mount(
    root,
    h(
      'section',
      { class: 'hero', 'aria-labelledby': 'hero-title' },
      h(
        'div',
        {},
        h('h1', { id: 'hero-title', class: 'hero-title' }, 'AI ARENA'),
        h('p', { class: 'hero-sub' }, 'Learn by Fighting'),
        h(
          'p',
          { class: 'hero-tagline' },
          'Don\'t ask AI for the answer. ',
          h('em', {}, 'Beat AI by understanding the answer.'),
          ' Pick a subject and an opponent. The AI makes a confident claim. Break it with reasoning, evidence and critical thinking.',
        ),
        h(
          'div',
          { class: 'hero-cta' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => navigate('subjects') }, 'ENTER THE ARENA ⚔'),
          resumable && h('button', { class: 'btn btn-lg', onclick: () => navigate('arena') }, 'RESUME BATTLE'),
        ),
      ),
      p &&
        h(
          'aside',
          { class: 'card player-card', 'aria-label': 'Your progress' },
          h('h2', {}, 'Challenger'),
          h('div', { class: 'row' }, levelBadge(p.level), xpBar(p)),
          h('div', { class: 'stat-line' }, h('span', {}, 'Lives per battle'), hearts(3, 3)),
          h('div', { class: 'stat-line' }, h('span', {}, 'Battles fought'), h('strong', {}, p.sessionsPlayed)),
        ),
    ),
    h(
      'section',
      { class: 'loop', 'aria-label': 'How the game works' },
      LOOP.map((s) =>
        h('div', { class: 'card loop-step' }, h('div', { class: 'icon', 'aria-hidden': 'true' }, s.icon), h('h3', {}, s.title), h('p', {}, s.text)),
      ),
    ),
  );
}
