// Client-side state. The server is the source of truth for the game; the
// browser only remembers who the player is, which battle they are in, and
// any unsent draft (so a refresh or disconnect never loses their typing).

const KEY_USER = 'arena.userId';
const KEY_SESSION = 'arena.sessionId';

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage, key, value) {
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // storage unavailable (private mode): the game still works for this tab
  }
}

export const state = {
  config: { mode: 'demo' },
  content: { subjects: [], characters: [], tiers: [] },
  player: null,
  view: null, // current public session view
  selection: { subjectId: null, characterId: null },
  forceMock: false, // player chose to continue with the offline opponent

  get userId() {
    return safeGet(localStorage, KEY_USER);
  },
  set userId(v) {
    safeSet(localStorage, KEY_USER, v);
  },
  get sessionId() {
    return safeGet(localStorage, KEY_SESSION);
  },
  set sessionId(v) {
    safeSet(localStorage, KEY_SESSION, v);
  },

  subject(id) {
    return this.content.subjects.find((s) => s.id === id);
  },
  character(id) {
    return this.content.characters.find((c) => c.id === id);
  },

  draftKey() {
    const v = this.view;
    return v?.challenge ? `arena.draft.${v.id}.${v.challengeNumber}` : null;
  },
  get draft() {
    const k = this.draftKey();
    return k ? safeGet(sessionStorage, k) || '' : '';
  },
  set draft(text) {
    const k = this.draftKey();
    if (k) safeSet(sessionStorage, k, text || null);
  },
};
