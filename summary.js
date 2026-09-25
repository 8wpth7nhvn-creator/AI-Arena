// End-of-session screen.

import { h, mount, richText } from '../ui/dom.js';
import { countUp, toast } from '../ui/components.js';
import { api } from '../api.js';
import { state } from '../state.js';

const END_TITLES = {
  finished: 'SESSION COMPLETE',
  out_of_lives: 'OUT OF LIVES',
  quit: 'BATTLE ENDED',
  abandoned: 'BATTLE ENDED',
};

export function renderSummary(root, { navigate }) {
  let alive = true;

  async function load() {
    let view = state.view;
    if (!view || view.id !== state.sessionId || !view.summary) {
      if (!state.sessionId) return navigate('');
      try {
        view = state.view = (await api.session(state.sessionId)).view;
      } catch {
        if (!alive) return;
        mount(root, h('div', { class: 'boot', role: 'alert' }, h('p', {}, 'Could not load results.'), h('button', { class: 'btn', onclick: load }, 'Retry')));
        return;
      }
    }
    if (!alive) return;
    if (view.status !== 'complete' || !view.summary) return navigate('arena');
    render(view);
  }

  async function rematch(view, btn) {
    btn.disabled = true;
    try {
      const res = await api.startSession({
        userId: state.userId,
        subjectId: view.subject.id,
        characterId: view.character.id,
        forceMock: state.forceMock,
      });
      state.view = res.view;
      state.sessionId = res.view.id;
      navigate('arena');
    } catch (err) {
      btn.disabled = false;
      toast(err.kind === 'network' ? 'Connection lost. Try again.' : err.message);
    }
  }

  function render(view) {
    const s = view.summary;
    const c = view.character;
    const xpEl = h('div', { class: 'xp-gain' }, '+0 XP');
    const nextBtn = h('button', { class: 'btn btn-primary btn-lg', onclick: () => rematch(view, nextBtn) }, 'NEXT BATTLE ⚔');

    mount(
      root,
      h(
        'div',
        { class: 'summary', style: { '--char': c.color } },
        h(
          'section',
          { class: 'card summary-hero', 'aria-labelledby': 'summary-title' },
          h('p', { class: 'eyebrow', style: { color: 'var(--accent-2)', letterSpacing: '0.25em', fontFamily: 'var(--font-display)' } }, `${view.subject.icon} ${view.subject.name} vs ${c.emoji} ${c.name}`),
          h('h1', { id: 'summary-title', style: { fontSize: 'clamp(30px,5vw,44px)', marginTop: '6px' } }, END_TITLES[s.endReason] || 'SESSION COMPLETE'),
          xpEl,
          h('p', { style: { color: 'var(--muted)', marginTop: '6px' } }, `Level ${view.player.level} · ${view.player.totalXp.toLocaleString('en-US')} total XP`),
          h('div', { class: 'coach' }, h('div', { class: 'opp-avatar', 'aria-hidden': 'true' }, c.emoji), h('div', {}, h('strong', { style: { color: 'var(--char)' } }, c.name), h('p', {}, s.coach))),
        ),
        h(
          'section',
          { class: 'stat-grid', 'aria-label': 'Session statistics' },
          stat(s.completed, 'Challenges completed'),
          stat(`${s.won}/${s.completed}`, 'Won'),
          stat(`${'❤️'.repeat(s.livesLeft)}${'🖤'.repeat(Math.max(0, view.maxLives - s.livesLeft))}`, 'Lives remaining', `${s.livesLeft} of ${view.maxLives}`),
          stat(s.goodQuestions, 'Good questions'),
        ),
        h(
          'div',
          { class: 'two-col' },
          h(
            'section',
            { class: 'card callout' },
            h('h3', {}, '💪 Strongest skill'),
            h('p', { class: 'big' }, s.strongest?.label || '—'),
            s.strongest && h('p', {}, `Average score ${s.strongest.score}/100`),
          ),
          h(
            'section',
            { class: 'card callout' },
            h('h3', {}, '🎯 Practice next'),
            h('p', { class: 'big' }, s.weakest?.label || 'Keep fighting to find out'),
            s.weakest && h('p', {}, `Tip: ${s.weakest.tip}`),
          ),
        ),
        h(
          'div',
          { class: 'two-col' },
          h(
            'section',
            { class: 'card' },
            h('h2', { style: { fontSize: '18px', marginBottom: '12px' } }, 'Skill profile'),
            s.skills.length
              ? h(
                  'ul',
                  { class: 'skill-bars' },
                  s.skills.map((k) =>
                    h(
                      'li',
                      {},
                      h('div', { class: 'name' }, h('span', {}, k.label), h('span', {}, `${k.score}`)),
                      h('div', { class: 'skill-track', role: 'img', 'aria-label': `${k.label}: ${k.score} out of 100` }, h('div', { class: 'skill-fill', style: { width: `${k.score}%` } })),
                    ),
                  ),
                )
              : h('p', { style: { color: 'var(--muted)' } }, 'No answers were scored this session.'),
          ),
          h(
            'section',
            { class: 'card' },
            h('h2', { style: { fontSize: '18px', marginBottom: '12px' } }, 'Recommended difficulty'),
            h('p', { class: 'big', style: { fontFamily: 'var(--font-display)', fontSize: '22px' } }, `Tier ${s.recommendedDifficulty.level} · ${s.recommendedDifficulty.name}`),
            h('p', { style: { color: 'var(--muted)', marginTop: '4px' } }, s.recommendedDifficulty.description),
            h(
              'p',
              { style: { color: 'var(--muted)', marginTop: '12px', fontSize: '14px' } },
              s.difficultyChange > 0 ? '📈 You climbed this session.' : s.difficultyChange < 0 ? '📉 The arena eased off to rebuild your footing.' : '➡️ Holding steady.',
              ` Hints used: ${s.hintsUsed}. Answer requests: ${s.answerRequests}.`,
            ),
          ),
        ),
        h(
          'div',
          { class: 'two-col' },
          h(
            'section',
            { class: 'card' },
            h('h2', { style: { fontSize: '18px', marginBottom: '12px' } }, '📚 Concepts learned'),
            s.conceptsLearned.length
              ? h('ul', { style: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '8px' } }, s.conceptsLearned.map((x) => h('li', {}, h('strong', {}, x.topic), ': ', x.summary)))
              : h('p', { style: { color: 'var(--muted)' } }, 'No challenges won yet. The explanations are in each round\'s feedback.'),
          ),
          h(
            'section',
            { class: 'card' },
            h('h2', { style: { fontSize: '18px', marginBottom: '12px' } }, '🔍 Mistakes discovered'),
            s.mistakes.length
              ? h('ul', { style: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '8px' } }, s.mistakes.map((m) => h('li', {}, h('strong', {}, m.label), ': ', richText(m.correction))))
              : h('p', { style: { color: 'var(--muted)' } }, 'No misconceptions detected.'),
          ),
        ),
        h(
          'div',
          { class: 'btn-row' },
          nextBtn,
          h('button', { class: 'btn btn-lg', onclick: () => navigate('subjects') }, 'Change subject'),
          h('button', { class: 'btn btn-lg btn-ghost', onclick: () => navigate('') }, 'Home'),
        ),
      ),
    );
    countUp(xpEl, s.xp, { prefix: '+', suffix: ' XP', ms: 1200 });
    nextBtn.focus({ preventScroll: true });
  }

  load();
  return () => {
    alive = false;
  };
}

function stat(value, label, aria) {
  return h('div', { class: 'card stat' }, h('div', { class: 'value', 'aria-label': aria }, value), h('div', { class: 'label' }, label));
}
