// XP and response classification. Every XP line has a human-readable label so
// the player can see exactly why they earned what they earned.

export const XP = Object.freeze({
  SOLVED: 100,
  DIFFICULTY_BONUS_PER_LEVEL: 10,
  STRONG_REASONING: 50,
  GOOD_EVIDENCE: 25,
  GOOD_QUESTION: 25,
  KEY_CLUE: 50,
  SELF_CORRECTION: 50,
  DEFENDED: 25,
  EXTRA_INSIGHT: 15,
  ANSWER_REQUEST_PENALTY: 15,
});

// Maximum share of the reward still available after N hints.
export const HINT_CAPS = [1, 0.8, 0.6, 0.4, 0.2];

export function hintCap(hintsUsed) {
  return HINT_CAPS[Math.min(hintsUsed, HINT_CAPS.length - 1)];
}

export function maxAvailableXp(challenge, difficulty, hintsUsed) {
  const potential =
    XP.SOLVED +
    XP.DIFFICULTY_BONUS_PER_LEVEL * (Math.round(difficulty) - 1) +
    XP.STRONG_REASONING +
    XP.GOOD_EVIDENCE +
    XP.GOOD_QUESTION +
    (challenge.clue ? XP.KEY_CLUE : 0) +
    (challenge.counter ? XP.DEFENDED : 0);
  return Math.round(potential * hintCap(hintsUsed));
}

/**
 * Derive response categories deterministically from the evaluation scores, so
 * classification is consistent across mock and live AI.
 */
export function classify(ev) {
  if (ev.flags.answer_request) return ['answer_request'];
  if (!ev.flags.relevant) return ['irrelevant'];
  const s = ev.scores;
  const cats = [];
  if (s.correctness >= 70) cats.push('correct');
  else if (s.correctness >= 40) cats.push('partially_correct');
  else if (!ev.flags.is_question && (ev.misconceptions.length || s.correctness < 20)) cats.push('incorrect');
  if (ev.misconceptions.length) cats.push('misconception');
  if (s.reasoning >= 65) cats.push('strong_reasoning');
  else if (s.reasoning < 40 && !ev.flags.is_question) cats.push('weak_reasoning');
  if (s.reasoning < 40 && s.evidence < 30 && !ev.flags.is_question && !ev.misconceptions.length) cats.push('unsupported');
  if (ev.flags.is_question && s.question_quality >= 50) cats.push('good_question');
  return cats;
}

/** XP for a finished challenge, with an itemized breakdown. */
export function challengeReward({ cs, challenge, difficulty, success }) {
  if (!success) {
    return { total: 0, breakdown: [{ label: 'Challenge failed', xp: 0 }], hintFactor: hintCap(cs.hintsUsed) };
  }
  const lines = [];
  lines.push({ label: 'Challenge solved', xp: XP.SOLVED });
  const diffBonus = XP.DIFFICULTY_BONUS_PER_LEVEL * (Math.round(difficulty) - 1);
  if (diffBonus > 0) lines.push({ label: `Difficulty bonus (tier ${Math.round(difficulty)})`, xp: diffBonus });
  if (cs.best.reasoning >= 70) lines.push({ label: 'Strong reasoning', xp: XP.STRONG_REASONING });
  if (cs.best.evidence >= 60) lines.push({ label: 'Good evidence', xp: XP.GOOD_EVIDENCE });
  if (cs.goodQuestions > 0) lines.push({ label: 'Good question', xp: XP.GOOD_QUESTION });
  if (cs.clueFound) lines.push({ label: 'Found the key clue', xp: XP.KEY_CLUE });
  if (cs.selfCorrected) lines.push({ label: 'Corrected your own mistake', xp: XP.SELF_CORRECTION });
  if (cs.counterIssued && cs.defense === 'explained') lines.push({ label: 'Defended against the counterargument', xp: XP.DEFENDED });
  const insights = challenge.concepts.filter((c) => !c.required && cs.concepts[c.id] === 'explained').length;
  if (insights) lines.push({ label: `Extra insight ×${insights}`, xp: XP.EXTRA_INSIGHT * insights });

  const subtotal = lines.reduce((s, l) => s + l.xp, 0);
  const factor = hintCap(cs.hintsUsed);
  let total = subtotal;
  if (factor < 1) {
    const cut = Math.round(subtotal * (1 - factor));
    lines.push({ label: `Hints used ×${cs.hintsUsed} (max reward ${Math.round(factor * 100)}%)`, xp: -cut });
    total -= cut;
  }
  if (cs.answerRequests > 0) {
    const penalty = XP.ANSWER_REQUEST_PENALTY * cs.answerRequests;
    lines.push({ label: `Asked for the answer ×${cs.answerRequests}`, xp: -penalty });
    total -= penalty;
  }
  return { total: Math.max(0, total), breakdown: lines, hintFactor: factor };
}
