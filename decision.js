// Turns a validated evaluation into game progress and picks the opponent's
// next action. Everything here is deterministic: the same evaluation in the
// same state always produces the same action. The AI never chooses actions.

export const ACTIONS = Object.freeze({
  ACCEPT: 'ACCEPT', // learning objective demonstrated: challenge won
  CHALLENGE: 'CHALLENGE', // reasonable but incomplete: ask a deeper follow-up
  COUNTERARGUMENT: 'COUNTERARGUMENT', // core understood: now defend it
  HINT: 'HINT', // stuck: nudge without revealing the answer
  CORRECT_MISCONCEPTION: 'CORRECT_MISCONCEPTION',
  END: 'END', // out of attempts: challenge lost, solution revealed
});

const RANK = { absent: 0, named: 1, explained: 2 };
const NAMED_FRACTION = 0.4; // share of a concept's HP dealt by naming it without explaining

export function upgrade(prev, next) {
  return RANK[next] > RANK[prev] ? next : prev;
}

export function maxFailedAttempts(character, difficulty) {
  return 3 + (character.mechanics.extraAttempts || 0) + (difficulty <= 2 ? 1 : 0);
}

export function counterRequired(challenge, character, difficulty) {
  return Boolean(challenge.counter) && Math.round(difficulty) >= character.mechanics.counterFromDifficulty;
}

export function evidenceRequired(challenge, character) {
  return Boolean(challenge.requireEvidence || character.mechanics.requireEvidence);
}

/**
 * Compute what this evaluation changes, without mutating state.
 * Returns the new concept statuses and a progress summary.
 */
export function measureProgress(cs, challenge, ev) {
  const concepts = { ...cs.concepts };
  const newlyNamed = [];
  const newlyExplained = [];
  let damage = 0;

  for (const c of challenge.concepts) {
    const prev = concepts[c.id] || 'absent';
    const next = upgrade(prev, ev.concepts[c.id] || 'absent');
    if (next === prev) continue;
    concepts[c.id] = next;
    if (next === 'explained') {
      newlyExplained.push(c.id);
      damage += prev === 'named' ? c.weight * (1 - NAMED_FRACTION) : c.weight;
    } else {
      newlyNamed.push(c.id);
      damage += c.weight * NAMED_FRACTION;
    }
  }

  let defense = cs.defense;
  let defenseGain = false;
  if (challenge.counter) {
    const next = upgrade(cs.defense, ev.defense);
    // Defense only counts once the counterargument is on the table, or when the
    // student pre-empts it with a full explanation.
    if (next !== cs.defense && (cs.counterIssued || next === 'explained')) {
      damage +=
        next === 'explained'
          ? challenge.counter.weight * (cs.defense === 'named' ? 1 - NAMED_FRACTION : 1)
          : challenge.counter.weight * NAMED_FRACTION;
      defense = next;
      defenseGain = true;
    }
  }

  const newMisconceptions = ev.misconceptions.filter((id) => !cs.misconceptionsSeen.includes(id));
  const repeatedMisconceptions = ev.misconceptions.filter((id) => cs.misconceptionsSeen.includes(id));

  return {
    concepts,
    defense,
    newlyNamed,
    newlyExplained,
    defenseGain,
    damage: Math.round(damage),
    newMisconceptions,
    repeatedMisconceptions,
    any: newlyNamed.length + newlyExplained.length > 0 || defenseGain,
  };
}

function nextTarget(challenge, concepts) {
  const required = challenge.concepts.filter((c) => c.required);
  return (
    required.find((c) => concepts[c.id] === 'named') ||
    required.find((c) => (concepts[c.id] || 'absent') === 'absent') ||
    challenge.concepts.find((c) => (concepts[c.id] || 'absent') === 'absent') ||
    null
  );
}

/**
 * Decide the opponent's next move.
 * @returns {{action, reason, failed, target, maxFailed}}
 */
export function decideAction({ cs, challenge, character, difficulty, ev, progress }) {
  const mech = character.mechanics;
  const concepts = progress.concepts;
  const coreDone = challenge.concepts.filter((c) => c.required).every((c) => concepts[c.id] === 'explained');
  const needCounter = counterRequired(challenge, character, difficulty);
  const needEvidence = evidenceRequired(challenge, character);
  const maxFailed = maxFailedAttempts(character, difficulty);
  const bestEvidence = Math.max(cs.best.evidence, ev.scores.evidence);
  const goodQuestion = ev.flags.is_question && ev.flags.relevant && ev.scores.question_quality >= 50;
  const target = nextTarget(challenge, concepts);

  let action;
  let reason;
  let failed = false;

  if (ev.flags.answer_request) {
    action = ACTIONS.CHALLENGE;
    reason = cs.answerRequests > 0 ? 'answer_request_repeat' : 'answer_request';
    failed = cs.answerRequests > 0; // the first request is a warning, repeats cost an attempt
  } else if (!ev.flags.relevant && !progress.any) {
    action = ACTIONS.CHALLENGE;
    reason = 'irrelevant';
    failed = true;
  } else if (ev.misconceptions.length && (progress.newMisconceptions.length || !progress.any)) {
    action = ACTIONS.CORRECT_MISCONCEPTION;
    reason = 'misconception';
    failed = !progress.any;
  } else if (coreDone) {
    const defended =
      progress.defense === 'explained' ||
      (progress.defense === 'named' && ev.scores.critical_thinking >= 40 && cs.counterIssued);
    if (needCounter && !cs.counterIssued && progress.defense !== 'explained') {
      action = ACTIONS.COUNTERARGUMENT;
      reason = 'counter';
    } else if (needCounter && !defended) {
      action = ACTIONS.CHALLENGE;
      reason = 'defend';
      failed = !progress.any;
    } else if (needEvidence && bestEvidence < 50) {
      action = ACTIONS.CHALLENGE;
      reason = 'evidence';
      failed = cs.evidenceAsked && !progress.any;
    } else {
      action = ACTIONS.ACCEPT;
      reason = 'objective_met';
    }
  } else if (progress.any) {
    action = ACTIONS.CHALLENGE;
    reason = target && concepts[target.id] === 'named' ? 'named' : 'progress';
  } else if (goodQuestion) {
    action = ACTIONS.CHALLENGE;
    reason = 'question';
  } else {
    failed = true;
    const stuck = cs.stuckStreak + 1;
    const canAutoHint = mech.autoHintAfter != null && stuck >= mech.autoHintAfter && cs.hintsUsed < 4;
    if (canAutoHint) {
      action = ACTIONS.HINT;
      reason = 'stuck';
    } else {
      action = ACTIONS.CHALLENGE;
      reason = target && concepts[target.id] === 'named' ? 'named' : 'weak';
    }
  }

  if (failed && action !== ACTIONS.ACCEPT && cs.failedAttempts + 1 >= maxFailed) {
    action = ACTIONS.END;
    reason = 'out_of_attempts';
  }

  return { action, reason, failed, target, maxFailed, goodQuestion };
}
