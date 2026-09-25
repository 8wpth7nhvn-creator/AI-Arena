// Tiny JSON-file persistence for players and sessions. Writes are debounced
// and atomic (write temp file, then rename) so a crash never corrupts data.
// Pass file: null for an in-memory store (tests).

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // prune sessions older than two weeks

export function createStore({ file = null, debounceMs = 150 } = {}) {
  let data = { players: {}, sessions: {} };
  if (file && existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
      data.players ??= {};
      data.sessions ??= {};
    } catch (err) {
      console.warn(`[store] could not read ${file}, starting fresh: ${err.message}`);
    }
  }

  let timer = null;
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of Object.entries(data.sessions)) if (s.updatedAt < cutoff) delete data.sessions[id];
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  }

  return {
    getPlayer: (id) => data.players[id] || null,
    savePlayer(p) {
      data.players[p.id] = p;
      this.schedule();
    },
    getSession: (id) => data.sessions[id] || null,
    saveSession(s) {
      s.updatedAt = Date.now();
      data.sessions[s.id] = s;
      this.schedule();
    },
    schedule() {
      if (!file || timer) return;
      timer = setTimeout(flush, debounceMs);
    },
    flush,
  };
}
