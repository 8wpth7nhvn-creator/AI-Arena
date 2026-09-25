// The Arena: where the fight happens. The server decides everything; this
// screen renders the battle, sends the player's arguments, and turns results
// into feedback (damage, lost hearts, XP, level-ups).

import { h, mount, clear, richText, announce } from '../ui/dom.js';
import { levelBadge, xpBar, hearts, openModal, levelUpOverlay, countUp, floatDamage, toast } from '../ui/components.js';
import { api, newId } from '../api.js';
import { state } from '../state.js';
import { updatePlayerChip } from '../app.js';
import { showRoundResult } from './result.js';

const MAX_LEN = 1500;

const CATEGORY_CHIPS = {
  correct: ['✓ Correct', 'good'],
  partially_correct: ['◐ Partially correct', 'warn'],
  incorrect: ['✗ Incorrect', 'bad'],
  strong_reasoning: ['💪 Strong reasoning', 'good'],
  weak_reasoning: ['⚠ Weak reasoning', 'warn'],
  unsupported: ['⚠ Unsupported claim', 'warn'],
  misconception: ['✗ Misconception', 'bad'],
  good_question: ['❓ Good question', 'good'],
  answer_request: ['🚫 Asked for the answer', 'bad'],
  irrelevant: ['✗ Off-topic', 'bad'],
};

export function renderArena(root, { navigate }) {
  let view = state.view;
  let pending = false;
  let renderedIds = new Set();
  let renderedChallenge = null;
  let alive = true;
  let unsentTurn = null; // a turn that failed in transit; resubmitting the same text reuses its id

  // ---- Static skeleton -----------------------------------------------------
  const hud = h('div', { class: 'hud', role: 'region', 'aria-label': 'Battle status' });
  const oppAvatar = h('div', { class: 'opp-avatar', 'aria-hidden': 'true' });
  const oppName = h('h2', { class: 'opp-name' });
  const oppTitle = h('p', { class: 'opp-title' });
  const hpFill = h('div', { class: 'hp-fill' });
  const hpTrack = h('div', { class: 'hp-track', role: 'progressbar', 'aria-label': 'Opponent argument strength' }, hpFill);
  const hpText = h('span');
  const pips = h('div', { class: 'pips', role: 'img' });
  const attemptsText = h('span');
  const hitsList = h('ul', { class: 'hits' });
  const maxXpEl = h('strong');

  const opponent = h(
    'aside',
    { class: 'card opponent', 'aria-label': 'Opponent' },
    h('div', { class: 'opp-head' }, oppAvatar, h('div', {}, oppName, oppTitle)),
    h('div', {}, h('div', { class: 'meter-label' }, h('span', {}, 'Argument strength'), hpText), hpTrack),
    h('div', {}, h('div', { class: 'meter-label' }, h('span', {}, 'Your attempts'), attemptsText), pips),
    h('div', { class: 'opp-section opp-extra' }, h('h3', {}, 'Your hits'), hitsList),
    h('div', { class: 'maxxp opp-extra' }, h('span', {}, 'Max XP available'), maxXpEl),
  );

  const log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Battle log', tabindex: '0' });
  const dock = h('div', { class: 'dock' });
  const battle = h('section', { class: 'card battle', 'aria-label': 'Battle' }, log, dock);

  // ---- Input dock ----------------------------------------------------------
  const textarea = h('textarea', {
    id: 'answer',
    maxlength: String(MAX_LEN),
    rows: '3',
    placeholder: 'Argue your case. Explain WHY, give evidence, consider exceptions…',
    'aria-describedby': 'answer-help answer-error',
  });
  const counter = h('span', { class: 'counter', id: 'answer-help' }, `0 / ${MAX_LEN}`);
  const fieldError = h('p', { class: 'field-error', id: 'answer-error', role: 'alert' });
  const hintBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => useHint() }, '💡 Hint');
  const submitBtn = h('button', { class: 'btn btn-attack', type: 'submit' }, 'DEFEND ANSWER ⚔');
  const form = h(
    'form',
    { onsubmit: (e) => (e.preventDefault(), submit()) },
    h('label', { class: 'dock-label', for: 'answer' }, h('span', {}, 'Your argument'), counter),
    textarea,
    fieldError,
    h(
      'div',
      { class: 'dock-actions' },
      h('span', { class: 'kbd-hint' }, h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, 'Enter'), ' to attack'),
      h('div', { class: 'btns' }, hintBtn, submitBtn),
    ),
  );

  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    counter.textContent = `${len} / ${MAX_LEN}`;
    counter.classList.toggle('over', len >= MAX_LEN);
    fieldError.textContent = '';
    state.draft = textarea.value;
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  });

  mount(root, h('section', { class: 'arena', 'aria-label': 'Arena' }, hud, h('div', { class: 'arena-main' }, opponent, battle)));

  // ---- Rendering -------------------------------------------------------------
  function renderHud({ heartBreak = false } = {}) {
    const v = view;
    mount(
      hud,
      h('div', { class: 'xp-block' }, levelBadge(v.player.level), xpBar(v.player)),
      h(
        'div',
        { class: 'hud-pills' },
        h('span', { class: 'pill' }, v.subject.icon, ' ', h('strong', {}, v.subject.name)),
        h('span', { class: 'pill', title: v.tier.description }, 'Tier ', h('strong', {}, `${v.tier.level} · ${v.tier.name}`)),
        h('span', { class: 'pill' }, 'Challenge ', h('strong', {}, `${v.challengeNumber}/${v.totalChallenges}`)),
      ),
      h(
        'div',
        { class: 'hud-end' },
        hearts(v.lives, v.maxLives, { breakingIndex: heartBreak ? v.lives : -1 }),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: retreat }, 'End battle'),
      ),
    );
  }

  function renderOpponent() {
    const c = view.character;
    const ch = view.challenge;
    root.querySelector('.arena').style.setProperty('--char', c.color);
    oppAvatar.textContent = c.emoji;
    oppName.textContent = c.name;
    oppTitle.textContent = c.title;
    const pct = Math.round((ch.hp / ch.maxHp) * 100);
    hpFill.style.width = `${pct}%`;
    hpFill.classList.toggle('low', pct <= 30);
    hpTrack.setAttribute('aria-valuenow', String(pct));
    hpTrack.setAttribute('aria-valuemin', '0');
    hpTrack.setAttribute('aria-valuemax', '100');
    hpText.textContent = ch.status === 'won' ? 'BROKEN' : `${pct}%`;
    attemptsText.textContent = `${ch.attemptsLeft} / ${ch.maxAttempts}`;
    pips.setAttribute('aria-label', `${ch.attemptsLeft} of ${ch.maxAttempts} attempts left`);
    mount(
      pips,
      Array.from({ length: ch.maxAttempts }, (_, i) => h('span', { class: `pip${i < ch.attemptsLeft ? '' : ' used'}` })),
    );
    mount(
      hitsList,
      ch.landed.length
        ? ch.landed.map((l) =>
            h('li', {}, h('span', { 'aria-hidden': 'true' }, l.status === 'explained' ? '✅' : '◐'), h('span', {}, `${l.label}${l.status === 'named' ? ' (named, explain why)' : ''}`)),
          )
        : h('li', { class: 'empty' }, 'No hits yet. Find the flaw in the claim.'),
    );
    maxXpEl.textContent = `${ch.maxXp} XP`;
    hintBtn.textContent =
      ch.hintsUsed >= ch.maxHints ? '💡 No hints left' : `💡 Hint ${ch.hintsUsed + 1}/${ch.maxHints} (max ${ch.maxXp}→${ch.nextHintMaxXp} XP)`;
  }

  function renderMessage(m) {
    const c = view.character;
    if (m.role === 'system' && m.kind === 'challenge') {
      return h(
        'div',
        { class: 'challenge-card msg' },
        h('div', { class: 'label' }, `CHALLENGE ${view.challengeNumber}`),
        h('blockquote', {}, `“${m.text}”`),
        m.code &&
          h(
            'pre',
            { 'aria-label': 'Code' },
            h('code', {}, m.code.split('\n').map((line, i) => [h('span', { class: 'lineno', 'aria-hidden': 'true' }, i + 1), line, '\n'])),
          ),
      );
    }
    if (m.role === 'system' && m.kind === 'tip') return h('p', { class: 'tip msg' }, '💡 Tip: ', m.text);
    if (m.role === 'player') {
      return h(
        'div',
        { class: 'msg player' },
        h('div', { class: 'msg-who' }, 'You'),
        h('div', { class: 'msg-bubble' }, m.text),
        m.report && renderReport(m.report),
      );
    }
    const isHint = m.action === 'HINT';
    return h(
      'div',
      { class: `msg ai${isHint ? ' hint' : ''}` },
      h(
        'div',
        { class: 'msg-who' },
        h('span', { 'aria-hidden': 'true' }, c.emoji),
        c.name,
        isHint && h('span', { class: 'tag' }, `Hint ${m.hintLevel || ''}`),
        m.action === 'COUNTERARGUMENT' && h('span', { class: 'tag' }, 'Counterattack'),
        m.action === 'CORRECT_MISCONCEPTION' && h('span', { class: 'tag' }, 'Misconception'),
      ),
      h('div', { class: 'msg-bubble' }, richText(m.text)),
    );
  }

  function renderReport(r) {
    const chips = [];
    if (r.damage > 0) chips.push(h('span', { class: 'chip dmg' }, `💥 −${r.damage} HP`));
    for (const l of r.landed) {
      chips.push(h('span', { class: `chip ${l.status === 'explained' ? 'good' : 'warn'}` }, l.status === 'explained' ? `✓ Explained: ${l.label}` : `◐ Named: ${l.label}`));
    }
    if (r.defended) chips.push(h('span', { class: 'chip good' }, r.defended === 'explained' ? '🛡 Counter defended' : '🛡 Defense started'));
    for (const cat of r.categories) {
      if (cat === 'misconception' && r.misconception) continue;
      const [label, tone] = CATEGORY_CHIPS[cat] || [cat, ''];
      chips.push(h('span', { class: `chip ${tone}` }, label));
    }
    if (r.misconception) chips.push(h('span', { class: 'chip bad' }, `✗ Misconception: ${r.misconception}`));
    if (r.failedAttempt) chips.push(h('span', { class: 'chip bad' }, '−1 attempt'));
    if (r.source === 'fallback') chips.push(h('span', { class: 'chip', title: 'The AI reply was malformed, so the backup evaluator scored this turn.' }, 'backup judge'));
    return h('div', { class: 'report', 'aria-label': 'Evaluation of your answer' }, chips);
  }

  function renderLog() {
    const ch = view.challenge;
    if (renderedChallenge !== view.challengeNumber) {
      clear(log);
      renderedIds = new Set();
      renderedChallenge = view.challengeNumber;
    }
    removeTransient();
    for (const m of ch.messages) {
      if (renderedIds.has(m.id)) continue;
      renderedIds.add(m.id);
      log.append(renderMessage(m));
    }
    scrollLog();
  }

  function renderDock() {
    const ch = view.challenge;
    if (ch.status === 'active' && view.status === 'active') {
      if (!dock.contains(form)) mount(dock, form);
      if (!textarea.value) textarea.value = state.draft;
      textarea.dispatchEvent(new Event('input'));
      setBusy(pending);
      return;
    }
    const over = view.status !== 'active';
    mount(
      dock,
      h(
        'div',
        { class: 'dock-done' },
        h('p', {}, ch.status === 'won' ? '🏆 Challenge won!' : '💀 Challenge lost.'),
        h(
          'div',
          { class: 'btn-row' },
          ch.result && h('button', { class: 'btn', onclick: () => showResult(ch.result) }, 'View feedback'),
          over
            ? h('button', { class: 'btn btn-primary', onclick: () => navigate('summary') }, 'SEE RESULTS')
            : h('button', { class: 'btn btn-primary', onclick: nextChallenge }, 'NEXT CHALLENGE ⚔'),
        ),
      ),
    );
  }

  function renderAll(opts) {
    renderHud(opts);
    renderOpponent();
    renderLog();
    renderDock();
    updatePlayerChip(view.player);
  }

  function scrollLog() {
    // Run twice: once now, once after entry animations and fonts settle.
    const toBottom = () => (log.scrollTop = log.scrollHeight);
    requestAnimationFrame(toBottom);
    setTimeout(toBottom, 350);
  }

  // ---- Transient UI: thinking indicator, pending bubble, errors ---------------
  function removeTransient() {
    log.querySelectorAll('[data-transient]').forEach((el) => el.remove());
    oppAvatar.classList.remove('thinking');
  }

  function showThinking() {
    oppAvatar.classList.add('thinking');
    const name = view.character.name.toUpperCase();
    log.append(
      h(
        'div',
        { class: 'thinking', 'data-transient': '', role: 'status' },
        h('span', { 'aria-hidden': 'true' }, view.character.emoji),
        `${name} is thinking`,
        h('span', { class: 'dots', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
      ),
    );
    scrollLog();
  }

  function showPendingBubble(text) {
    log.append(
      h('div', { class: 'msg player', 'data-transient': '' }, h('div', { class: 'msg-who' }, 'You'), h('div', { class: 'msg-bubble' }, text)),
    );
  }

  function showError(err, retry, { text } = {}) {
    removeTransient();
    if (text) showPendingBubble(text);
    const aiDown = err.kind === 'ai_unavailable';
    const message = aiDown
      ? `⚡ ${view.character.name} is reconnecting… Your progress is safe and no lives were lost.`
      : err.kind === 'network'
        ? '📡 Connection lost. Your progress is saved. Retry when you are back online.'
        : err.message;
    const offline =
      aiDown && state.config.mode === 'live' && !state.forceMock
        ? h(
            'button',
            {
              class: 'btn btn-sm',
              onclick: () => {
                state.forceMock = true;
                toast('Switched to the offline demo opponent for this session.');
                retry();
              },
            },
            'Continue with offline opponent',
          )
        : null;
    log.append(
      h(
        'div',
        { class: 'alert', role: 'alert', 'data-transient': '' },
        h('p', {}, message),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-sm btn-primary', 'data-retry': '', onclick: retry }, 'Retry'), offline),
      ),
    );
    scrollLog();
    log.querySelector('[data-retry]')?.focus();
  }

  function setBusy(busy) {
    pending = busy;
    submitBtn.disabled = busy;
    hintBtn.disabled = busy || view.challenge.hintsUsed >= view.challenge.maxHints;
    submitBtn.textContent = busy ? 'Opponent responding…' : 'DEFEND ANSWER ⚔';
    textarea.readOnly = busy;
  }

  // ---- Actions --------------------------------------------------------------
  function validate(text) {
    if (!text) return 'Write something before you attack!';
    if (text.length > MAX_LEN) return `Keep it under ${MAX_LEN} characters. Sharp arguments win.`;
    return null;
  }

  async function submit(retryTurn = null) {
    if (pending) return;
    const text = textarea.value.trim();
    const turn = retryTurn || (unsentTurn?.message === text ? unsentTurn : { turnId: newId(), message: text });
    const problem = validate(turn.message);
    if (problem) {
      fieldError.textContent = problem;
      textarea.focus();
      return;
    }
    setBusy(true);
    removeTransient();
    showPendingBubble(turn.message);
    showThinking();
    const before = view;
    try {
      const res = await api.turn(view.id, { ...turn, forceMock: state.forceMock });
      if (!alive) return;
      textarea.value = '';
      state.draft = '';
      unsentTurn = null;
      view = state.view = res.view;
      setBusy(false);
      afterTurn(before, res);
    } catch (err) {
      if (!alive) return;
      setBusy(false);
      if (err.kind === 'client' && err.status !== 409) {
        removeTransient();
        fieldError.textContent = err.message;
        textarea.focus();
        return;
      }
      if (err.code === 'challenge_over') return reload();
      removeTransient();
      unsentTurn = turn;
      showError(err, () => submit(turn), { text: turn.message });
    }
  }

  function afterTurn(before, res) {
    const lifeLost = view.lives < before.lives;
    renderAll({ heartBreak: lifeLost });
    const report = res.turn?.report;
    if (report?.damage > 0) {
      oppAvatar.classList.remove('hit');
      void oppAvatar.offsetWidth;
      oppAvatar.classList.add('hit');
      floatDamage(hpTrack, `−${report.damage}`);
    }
    const last = view.challenge.messages[view.challenge.messages.length - 1];
    if (last?.role === 'ai') announce(`${view.character.name}: ${last.text}`);
    if (res.result) setTimeout(() => alive && showResult(res.result, before.player), 900);
    else textarea.focus();
  }

  async function showResult(result, playerBefore = null) {
    await showRoundResult(result, {
      view,
      playerBefore,
      onNext: () => (view.status === 'active' ? nextChallenge() : navigate('summary')),
    });
  }

  async function useHint(retryTurn = null) {
    if (pending) return;
    const turn = retryTurn || { turnId: newId() };
    setBusy(true);
    removeTransient();
    showThinking();
    try {
      const res = await api.hint(view.id, { ...turn, forceMock: state.forceMock });
      if (!alive) return;
      view = state.view = res.view;
      setBusy(false);
      renderAll();
      textarea.focus();
    } catch (err) {
      if (!alive) return;
      setBusy(false);
      if (err.kind === 'client' && err.status !== 409) {
        removeTransient();
        toast(err.message);
        return;
      }
      showError(err, () => useHint(turn));
    }
  }

  async function nextChallenge(retryTurn = null) {
    if (pending) return;
    const turn = retryTurn || { turnId: newId() };
    pending = true;
    removeTransient();
    showThinking();
    try {
      const res = await api.next(view.id, { ...turn, forceMock: state.forceMock });
      if (!alive) return;
      view = state.view = res.view;
      pending = false;
      renderAll();
      textarea.focus();
    } catch (err) {
      if (!alive) return;
      pending = false;
      if (err.code === 'challenge_active' || err.code === 'session_over') return reload();
      showError(err, () => nextChallenge(turn));
    }
  }

  function retreat() {
    const confirmBtn = h('button', { class: 'btn btn-primary', onclick: doEnd }, 'End battle');
    const modal = openModal(
      h(
        'div',
        {},
        h('h2', {}, 'Retreat from battle?'),
        h('p', { style: { marginTop: '10px', color: 'var(--muted)' } }, 'Your XP so far is kept. The current challenge will not count, and it will not cost a life.'),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn', 'data-autofocus': true, onclick: () => modal.close() }, 'Keep fighting'),
          confirmBtn,
        ),
      ),
      { label: 'End battle?', dismissable: true },
    );
    async function doEnd() {
      confirmBtn.disabled = true;
      try {
        const res = await api.end(view.id, { turnId: newId(), forceMock: state.forceMock });
        view = state.view = res.view;
        modal.close();
        navigate('summary');
      } catch (err) {
        confirmBtn.disabled = false;
        toast(err.kind === 'network' ? 'Connection lost. Try again.' : err.message);
      }
    }
  }

  // ---- Load --------------------------------------------------------------------
  async function reload() {
    if (!state.sessionId) return navigate('subjects');
    try {
      const res = await api.session(state.sessionId);
      if (!alive) return;
      view = state.view = res.view;
      if (view.status === 'complete' && view.challenge?.status === 'active') return navigate('summary');
      renderAll();
      if (view.challenge.status === 'active') textarea.focus();
    } catch (err) {
      if (!alive) return;
      if (err.status === 404 || err.status === 400) {
        state.sessionId = null;
        return navigate('subjects');
      }
      mount(
        log,
        h(
          'div',
          { class: 'alert', role: 'alert' },
          h('p', {}, '📡 Could not load your battle. Your progress is saved on the server.'),
          h('button', { class: 'btn btn-sm btn-primary', onclick: reload }, 'Retry'),
        ),
      );
    }
  }

  if (view && view.id === state.sessionId) renderAll();
  else {
    mount(hud, h('p', { role: 'status' }, 'Loading battle…'));
    reload();
  }

  return () => {
    alive = false;
  };
}
