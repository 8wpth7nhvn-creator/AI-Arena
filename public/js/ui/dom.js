// Minimal DOM builder. Text is always inserted as text nodes, so player and
// AI content can never inject HTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Render text with *emphasis* markers as <em>, safely. */
export function richText(text) {
  return String(text)
    .split(/(\*[^*]+\*)/g)
    .map((part) => (/^\*[^*]+\*$/.test(part) ? h('em', {}, part.slice(1, -1)) : part));
}

export function announce(text) {
  const el = document.getElementById('sr-announcer');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => (el.textContent = text), 30);
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}
