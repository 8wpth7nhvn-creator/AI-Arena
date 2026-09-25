// Adaptive difficulty. Difficulty is a float in [1, 6]; challenges are picked
// by rounding it. It moves at most one small step per challenge so players
// never jump from beginner to expert.

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 6;

export const TIERS = [
  { level: 1, name: 'Recognition', description: 'Basic concept recognition' },
  { level: 2, name: 'Application', description: 'Applying a concept' },
  { level: 3, name: 'Problem Solving', description: 'Solving multi-step problems' },
  { level: 4, name: 'Conflicting Info', description: 'Reasoning through conflicting information' },
  { level: 5, name: 'Complex Reasoning', description: 'Complex, multi-factor reasoning' },
  { level: 6, name: 'Open Argument', description: 'Open-ended argumentation' },
];

export function tierFor(difficulty) {
  const lvl = Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.round(difficulty)));
  return TIERS[lvl - 1];
}

/**
 * Score 0..1 for one finished challenge from the signals the spec asks us to
 * track: success, reasoning quality, hints, failed attempts, repeated
 * misconceptions and completion speed (number of turns).
 */
export function performanceScore(cs, success) {
  let p = success ? 0.5 : 0;
  p += 0.2 * (cs.best.reasoning / 100);
  p += cs.best.evidence >= 50 ? 0.1 : 0;
  p += cs.best.critical_thinking >= 50 ? 0.05 : 0;
  p += success && cs.turns <= 3 ? 0.1 : 0;
  p -= 0.08 * cs.hintsUsed;
  p -= 0.05 * cs.failedAttempts;
  p -= 0.1 * cs.misconceptionRepeats;
  if (!success) p = Math.min(p, 0.2);
  return Math.max(0, Math.min(1, p));
}

export function nextDifficulty(current, performance, mechanics = {}) {
  const step = mechanics.difficultyStep ?? 1;
  let delta = 0;
  if (performance >= 0.75) delta = 0.5 * step;
  else if (performance >= 0.55) delta = 0.25 * step;
  else if (performance < 0.3) delta = -0.5; // struggling: ease off at the same pace for everyone
  const next = Math.round((current + delta) * 4) / 4;
  return Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, next));
}

/** Players who just failed, or are at the bottom tier, get extra scaffolding. */
export function needsScaffold(session) {
  const last = session.completed[session.completed.length - 1];
  return (last && !last.success) || session.difficulty < 1.5;
}
