import cs from './cs.js';
import economics from './economics.js';
import biology from './biology.js';
import history from './history.js';
import psychology from './psychology.js';
import { SUBJECTS } from '../subjects.js';

// Verified challenge bank. The AI never invents the facts a challenge is
// judged on; it only rephrases, probes and evaluates around this content.
const ALL = [...cs, ...economics, ...biology, ...history, ...psychology];

// Weights decide how much "opponent HP" each concept is worth.
const WEIGHT_REQUIRED = 30;
const WEIGHT_OPTIONAL = 15;
const WEIGHT_DEFENSE = 25;

function prepare(ch) {
  const problems = [];
  if (!SUBJECTS.some((s) => s.id === ch.subject)) problems.push('unknown subject');
  if (!ch.objective) problems.push('missing objective');
  if (!Array.isArray(ch.hints) || ch.hints.length !== 4) problems.push('needs exactly 4 hints');
  if (!ch.concepts?.some((c) => c.required !== false)) problems.push('needs a required concept');
  if (ch.clue && !ch.concepts.some((c) => c.id === ch.clue)) problems.push('clue must reference a concept');
  if (problems.length) throw new Error(`Challenge ${ch.id}: ${problems.join(', ')}`);

  const concepts = ch.concepts.map((c) => ({
    ...c,
    required: c.required !== false,
    weight: c.weight ?? (c.required === false ? WEIGHT_OPTIONAL : WEIGHT_REQUIRED),
  }));
  const maxHp =
    concepts.reduce((sum, c) => sum + c.weight, 0) + (ch.counter ? WEIGHT_DEFENSE : 0);
  return Object.freeze({
    xp: 100,
    misconceptions: [],
    keywords: [],
    ...ch,
    concepts,
    counter: ch.counter ? { ...ch.counter, weight: WEIGHT_DEFENSE } : null,
    maxHp,
  });
}

const BANK = new Map();
for (const ch of ALL) {
  if (BANK.has(ch.id)) throw new Error(`Duplicate challenge id ${ch.id}`);
  BANK.set(ch.id, prepare(ch));
}

export function getChallenge(id) {
  return BANK.get(id) || null;
}

export function challengesForSubject(subjectId) {
  return [...BANK.values()].filter((c) => c.subject === subjectId);
}

/**
 * Pick the next challenge: closest to the target difficulty, preferring
 * challenges and topics the player has not seen yet. Deterministic so that
 * adaptive difficulty is predictable and testable.
 */
export function pickChallenge(subjectId, targetDifficulty, { exclude = [], seenTopics = [] } = {}) {
  const pool = challengesForSubject(subjectId);
  const fresh = pool.filter((c) => !exclude.includes(c.id));
  const candidates = fresh.length ? fresh : pool;
  const score = (c) =>
    Math.abs(c.difficulty - targetDifficulty) * 10 +
    (seenTopics.includes(c.topic) ? 3 : 0) +
    // Prefer slightly easier over slightly harder on ties (gradual progression).
    (c.difficulty > targetDifficulty ? 1 : 0);
  return [...candidates].sort((a, b) => score(a) - score(b) || a.difficulty - b.difficulty)[0];
}
