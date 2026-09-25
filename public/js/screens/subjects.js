import { h, mount } from '../ui/dom.js';
import { state } from '../state.js';

export function renderSubjects(root, { navigate }) {
  const choose = (id) => {
    state.selection.subjectId = id;
    navigate('characters');
  };
  mount(
    root,
    h('button', { class: 'back-link', onclick: () => navigate('') }, '← Home'),
    h(
      'header',
      { class: 'screen-head' },
      h('p', { class: 'eyebrow' }, 'Step 1 of 2'),
      h('h1', {}, 'Choose your battlefield'),
      h('p', {}, 'Every subject tests reasoning, not memorization.'),
    ),
    h(
      'div',
      { class: 'select-grid', role: 'list' },
      state.content.subjects.map((s) => {
        const progress = state.player?.subjects?.[s.id];
        return h(
          'div',
          { role: 'listitem' },
          h(
            'button',
            {
              class: 'select-card',
              style: { '--card-color': s.color },
              'aria-pressed': String(state.selection.subjectId === s.id),
              onclick: () => choose(s.id),
            },
            h('span', { class: 'check' }, '✓ SELECTED'),
            h('span', { class: 'icon', 'aria-hidden': 'true' }, s.icon),
            h('h3', {}, s.name),
            h('p', {}, s.description),
            h('span', { class: 'meta' }, progress ? `Tier ${progress.tier.level}: ${progress.tier.name}` : 'New · Tier 1: Recognition'),
          ),
        );
      }),
    ),
  );
}
