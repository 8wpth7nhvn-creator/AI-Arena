// API client. Normalizes every failure into an ApiError with a `kind`:
//   network       - no connection / timeout (state is safe, retry)
//   ai_unavailable - the AI opponent is down (state is safe, retry)
//   client        - the request was rejected (e.g. empty answer)
//   server        - unexpected server error

export class ApiError extends Error {
  constructor(kind, message, { status = 0, code = null } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
  get retryable() {
    return this.kind === 'network' || this.kind === 'ai_unavailable' || this.status === 409;
  }
}

const TIMEOUT_MS = 90_000;

// The static GitHub Pages build sets <html data-backend="local">: the game
// engine then runs in the browser instead of on a server.
const LOCAL = document.documentElement.dataset.backend === 'local';
let localBackend = null;

async function localRequest(method, path, body) {
  localBackend ??= await import('./local/backend.js');
  const { status, json } = await localBackend.handle(method, path, body);
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

async function request(method, path, body) {
  if (LOCAL) return handleResponse(await localRequest(method, path, body));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network', navigator.onLine === false ? 'You are offline.' : 'Connection lost.');
  } finally {
    clearTimeout(timer);
  }
  return handleResponse(res);
}

async function handleResponse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    // fall through with null data
  }
  if (res.ok && data) return data;
  const err = data?.error || {};
  if (res.status === 503 || err.code === 'ai_unavailable') {
    throw new ApiError('ai_unavailable', err.message || 'Your opponent is reconnecting…', { status: res.status, code: err.code });
  }
  if (res.status >= 400 && res.status < 500) {
    throw new ApiError('client', err.message || 'Request rejected.', { status: res.status, code: err.code });
  }
  throw new ApiError('server', err.message || 'Something went wrong.', { status: res.status, code: err.code });
}

export const api = {
  config: () => request('GET', '/api/config'),
  content: () => request('GET', '/api/content'),
  player: (userId) => request('POST', '/api/player', { userId }),
  startSession: (payload) => request('POST', '/api/sessions', payload),
  session: (id) => request('GET', `/api/sessions/${encodeURIComponent(id)}`),
  turn: (id, payload) => request('POST', `/api/sessions/${encodeURIComponent(id)}/turn`, payload),
  hint: (id, payload) => request('POST', `/api/sessions/${encodeURIComponent(id)}/hint`, payload),
  next: (id, payload) => request('POST', `/api/sessions/${encodeURIComponent(id)}/next`, payload),
  end: (id, payload) => request('POST', `/api/sessions/${encodeURIComponent(id)}/end`, payload),
};

export const newId = () =>
  crypto.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
