// End-of-challenge feedback: result, XP breakdown, why, concept learned,
// mistakes, improvement and the recommended next topic.

import { h, richText } from '../ui/dom.js';
import { openModal, countUp, levelUpOverlay } from '../ui/components.js';

export function showRoundResult(result, { view, playerBefore, onNext }) {
  return new Promise((resolve) => {
    const xpEl = h('div', { class: 'xp-gain', 'aria-label': `${result.xp} XP gained` }, '+0 XP');
    const total = result.breakdown.reduce((s, l) => s + l.xp, 0);
    const diff = result.difficulty;
    const diffNotice =
      diff.after > diff.before
        ? `📈 Difficulty rising: ${diff.tierAfter.name} (tier ${diff.tierAfter.level}). Your next opponent hits harder.`
        : diff.after < diff.before
          ? `📉 Difficulty eased to ${diff.tierAfter.name} (tier ${diff.tierAfter.level}), with more scaffolding next round.`
          : `➡️ Difficulty holds at ${diff.tierAfter.name} (tier ${diff.tierAfter.level}).`;

    let chosen = 'review';
    const nextLabel = result.sessionOver ? 'SEE RESULTS' : 'NEXT CHALLENGE ⚔';
    const modal = openModal(
      h(
        'div',
        {},
        h(
          'header',
          { class: 'result-head' },
          h('h2', { class: `verdict ${result.success ? 'win' : 'loss'}` }, result.success ? 'VICTORY' : 'DEFEATED'),
          xpEl,
          h('p', { class: 'sub' }, `Topic: ${result.topic}`),
        ),
        h(
          'ul',
          { class: 'breakdown', 'aria-label': 'XP breakdown' },
          result.breakdown.map((l) => h('li', { class: l.xp < 0 ? 'neg' : '' }, h('span', {}, l.label), h('span', {}, `${l.xp >= 0 ? '+' : ''}${l.xp}`))),
          h('li', { class: 'total' }, h('span', {}, 'Total'), h('span', {}, `+${Math.max(0, total)} XP`)),
        ),
        section(result.success ? 'Why you won' : 'Why you lost', h('p', {}, result.why)),
        section('Concept learned', h('p', {}, result.conceptLearned), h('p', { class: 'muted' }, result.explanation)),
        section(
          'Mistakes identified',
          result.mistakes.length
            ? h('ul', {}, result.mistakes.map((m) => h('li', {}, h('strong', {}, m.label), ': ', richText(m.correction))))
            : h('p', {}, result.success ? 'None. A clean fight.' : 'No misconceptions detected. You were missing pieces, not holding wrong ideas.'),
        ),
        section('Improve', h('p', {}, result.improve)),
        section('Recommended next topic', h('p', {}, result.nextTopic)),
        section('Learning objective', h('p', { class: 'muted' }, result.objective)),
        result.lifeLost &&
          h('p', { class: 'notice bad', role: 'status' }, `💔 You lost a life. ${result.livesLeft} ${result.livesLeft === 1 ? 'life' : 'lives'} remaining.`),
        h('p', { class: 'notice' }, diffNotice),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => ((chosen = 'review'), modal.close()) }, 'Review battle'),
          h('button', { class: 'btn btn-primary', 'data-autofocus': true, onclick: () => ((chosen = 'next'), modal.close()) }, nextLabel),
        ),
      ),
      {
        label: result.success ? 'Victory: challenge results' : 'Defeated: challenge results',
        dismissable: true,
        onClose: async () => {
          if (result.levelUp && !result._levelShown) {
            result._levelShown = true;
            await levelUpOverlay(result.levelUp.to);
          }
          if (chosen === 'next') onNext();
          resolve();
        },
      },
    );
    countUp(xpEl, result.xp, { prefix: '+', suffix: ' XP' });
  });
}

function section(title, ...content) {
  return h('section', { class: 'fb-section' }, h('h3', {}, title), content);
}
