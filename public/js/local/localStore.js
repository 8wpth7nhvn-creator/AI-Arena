// Browser version of server/persistence/store.js: same interface, saved in
// localStorage so progress survives refreshes. Falls back to memory when
// storage is unavailable (private mode), so the game still works.

const KEY = 'arena.db.v1';
const MAX_SESSIONS = 15;

export function createLocalStore() {
  let data = { players: {}, sessions: {} };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.players && saved?.sessions) data = saved;
  } catch {
    // corrupt or unavailable storage: start fresh
  }

  function flush() {
    const sessions = Object.values(data.sessions).sort((a, b) => b.updatedAt - a.updatedAt);
    for (const s of sessions.slice(MAX_SESSIONS)) delete data.sessions[s.id];
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // quota or privacy mode: keep playing in memory
    }
  }

  return {
    getPlayer: (id) => data.players[id] || null,
    savePlayer(p) {
      data.players[p.id] = p;
      flush();
    },
    getSession: (id) => data.sessions[id] || null,
    saveSession(s) {
      s.updatedAt = Date.now();
      data.sessions[s.id] = s;
      flush();
    },
    schedule: flush,
    flush,
  };
}
