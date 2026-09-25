import { h, mount } from '../ui/dom.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { toast } from '../ui/components.js';

export function renderCharacters(root, { navigate }) {
  const subject = state.subject(state.selection.subjectId);
  if (!subject) {
    navigate('subjects');
    return;
  }
  state.selection.characterId ??= 'boss';

  const cards = new Map();
  const summary = h('p', { 'aria-live': 'polite' });
  const fightBtn = h('button', { class: 'btn btn-primary btn-lg', onclick: start }, 'ENTER THE ARENA ⚔');

  function select(id) {
    state.selection.characterId = id;
    for (const [cid, el] of cards) el.setAttribute('aria-pressed', String(cid === id));
    const c = state.character(id);
    mount(summary, h('strong', {}, `${subject.icon} ${subject.name}`), ' vs ', h('strong', {}, `${c.emoji} ${c.name}`), ` · ${c.difficultyLabel}`);
  }

  async function start() {
    fightBtn.disabled = true;
    fightBtn.textContent = 'Entering…';
    try {
      const { view } = await api.startSession({
        userId: state.userId,
        subjectId: subject.id,
        characterId: state.selection.characterId,
        forceMock: state.forceMock,
      });
      state.view = view;
      state.sessionId = view.id;
      navigate('arena');
    } catch (err) {
      toast(err.kind === 'network' ? 'Connection lost. Try again.' : err.message);
      fightBtn.disabled = false;
      fightBtn.textContent = 'ENTER THE ARENA ⚔';
    }
  }

  mount(
    root,
    h('button', { class: 'back-link', onclick: () => navigate('subjects') }, '← Subjects'),
    h(
      'header',
      { class: 'screen-head' },
      h('p', { class: 'eyebrow' }, 'Step 2 of 2'),
      h('h1', {}, 'Choose your opponent'),
      h('p', {}, 'Each opponent plays differently. The scoring is the same for all of them.'),
    ),
    h(
      'div',
      { class: 'select-grid char-grid', role: 'group', 'aria-label': 'Opponent' },
      state.content.characters.map((c) => {
        const card = h(
          'button',
          {
            class: 'select-card char-card',
            style: { '--card-color': c.color },
            'aria-pressed': 'false',
            onclick: () => select(c.id),
            ondblclick: start,
          },
          h('span', { class: 'check' }, '✓ SELECTED'),
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, c.emoji),
          h('h3', {}, c.name),
          h('span', { class: 'title' }, c.title),
          h('p', {}, c.description),
          h('ul', {}, c.behaviors.map((b) => h('li', {}, b))),
          h('span', { class: 'meta' }, `Style: ${c.difficultyLabel}`),
        );
        cards.set(c.id, card);
        return card;
      }),
    ),
    h('div', { class: 'confirm-bar' }, summary, fightBtn),
  );
  select(state.selection.characterId);
}
