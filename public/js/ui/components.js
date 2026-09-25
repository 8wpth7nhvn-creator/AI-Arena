import { h, formatNumber } from './dom.js';

export function levelBadge(level, { small = false } = {}) {
  return h(
    'div',
    { class: `level-badge${small ? ' sm' : ''}`, role: 'img', 'aria-label': `Level ${level}` },
    h('div', {}, h('small', {}, 'LVL'), h('strong', {}, level)),
  );
}

/** XP bar: "1,420 / 1,750 XP". `from` animates the fill from a previous value. */
export function xpBar(player, { from = null, compact = false } = {}) {
  const pct = Math.round(player.progress * 100);
  const fill = h('div', { class: 'xpbar-fill' });
  const start = from == null ? pct : Math.round(from * 100);
  fill.style.width = `${start}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));
  return h(
    'div',
    { class: 'xpbar' },
    h(
      'div',
      {
        class: 'xpbar-track',
        role: 'progressbar',
        'aria-label': 'Experience toward next level',
        'aria-valuemin': player.levelStartXp,
        'aria-valuemax': player.nextLevelXp,
        'aria-valuenow': player.totalXp,
      },
      fill,
    ),
    h(
      'div',
      { class: 'xpbar-label' },
      compact
        ? `${formatNumber(player.totalXp)} XP`
        : `${formatNumber(player.totalXp)} / ${formatNumber(player.nextLevelXp)} XP`,
    ),
  );
}

export function hearts(lives, max, { breakingIndex = -1 } = {}) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const alive = i < lives;
    items.push(
      h('span', { class: `heart${alive ? '' : ' lost'}${i === breakingIndex ? ' breaking' : ''}`, 'aria-hidden': 'true' }, alive ? '❤️' : '🖤'),
    );
  }
  return h('span', { class: 'hearts', role: 'img', 'aria-label': `${lives} of ${max} lives remaining` }, items);
}

export function toast(message, ms = 3500) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast', role: 'status' }, message);
  root.append(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * Accessible modal. Traps focus, closes on Escape only when `dismissable`,
 * and restores focus to the previously focused element.
 */
export function openModal(content, { label, dismissable = false, onClose, className = 'modal' } = {}) {
  const root = document.getElementById('overlay-root');
  const previous = document.activeElement;
  const box = h('div', { class: className, role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, content);
  const overlay = h('div', { class: 'overlay' }, box);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if (previous && document.contains(previous)) previous.focus();
    onClose?.();
  }
  function onKey(e) {
    if (e.key === 'Escape' && dismissable) {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') {
      const focusables = [...box.querySelectorAll('button, [href], textarea, input, select, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.disabled,
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  if (dismissable) overlay.addEventListener('click', (e) => e.target === overlay && close());
  document.addEventListener('keydown', onKey, true);
  root.append(overlay);
  const autofocus = box.querySelector('[data-autofocus]') || box.querySelector('button');
  setTimeout(() => {
    autofocus?.focus({ preventScroll: true });
    box.scrollTop = 0;
  }, 50);
  return { close, box };
}

export function levelUpOverlay(level) {
  return new Promise((resolve) => {
    const btn = h('button', { class: 'btn btn-primary', 'data-autofocus': true, onclick: () => modal.close() }, 'CONTINUE');
    const modal = openModal(
      h(
        'div',
        { class: 'levelup' },
        h('div', { class: 'burst' }, 'LEVEL UP'),
        h('div', { class: 'big', 'aria-hidden': 'true' }, level),
        h('p', {}, `You reached level ${level}. Your opponents are taking notice.`),
        h('div', { class: 'btn-row', style: { marginTop: '20px' } }, btn),
      ),
      { label: `Level up! You reached level ${level}`, dismissable: true, onClose: resolve, className: 'modal' },
    );
  });
}

/** Animate a number counting up inside `el`. */
export function countUp(el, to, { prefix = '', suffix = '', ms = 900 } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || to <= 0) {
    el.textContent = `${prefix}${formatNumber(to)}${suffix}`;
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${prefix}${formatNumber(to * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function floatDamage(anchor, text) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const el = h('div', { class: 'float-dmg', 'aria-hidden': 'true' }, text);
  el.style.position = 'fixed';
  el.style.left = `${rect.left + rect.width / 2 - 30}px`;
  el.style.top = `${rect.top}px`;
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
}
