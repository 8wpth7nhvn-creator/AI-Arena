// Builds a "speech brief": what the opponent must say next (decided by the
// engine), independent of how it is phrased. The mock AI renders a brief with
// the character's templates; the live AI rephrases it in character. Either
// way the educational content comes from the verified challenge bank.

const LINE_FOR = {
  OPEN: 'open',
  ACCEPT: 'accept',
  END: 'end',
  COUNTERARGUMENT: 'counter',
  CORRECT_MISCONCEPTION: 'correction',
  HINT: 'hint',
};

const LINE_FOR_CHALLENGE_REASON = {
  answer_request: 'answerRequest',
  answer_request_repeat: 'answerRequestRepeat',
  irrelevant: 'irrelevant',
  defend: 'defend',
  evidence: 'evidence',
  named: 'namedNotExplained',
  progress: 'progress',
  question: 'question',
  weak: 'weak',
};

function shortQuote(text, max = 70) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/**
 * @param {object} p
 * @param {string} p.action   engine action (or 'OPEN')
 * @param {string} [p.reason]
 * @param {object} p.character
 * @param {object} p.challenge
 * @param {object} [p.target]      concept the follow-up should aim at
 * @param {string} [p.playerText]  latest player message (for conversational memory)
 * @param {string} [p.hintText]
 * @param {object} [p.misconception]
 * @param {number} [p.round]
 */
export function buildBrief(p) {
  const { action, reason, character, challenge, target, playerText, hintText, misconception, round, variant = 0 } = p;
  const key = action === 'CHALLENGE' ? LINE_FOR_CHALLENGE_REASON[reason] || 'weak' : LINE_FOR[action];

  let followUp = target?.followUp || '';
  if (reason === 'defend' && challenge.counter) followUp = challenge.counter.followUp;
  if (action === 'CORRECT_MISCONCEPTION' && !followUp) followUp = '';

  const slots = {
    round: String(round ?? 1),
    variant: String(variant),
    concept: target ? `"${target.label.replace(/^[A-Z](?=[a-z])/, (ch) => ch.toLowerCase())}"` : '',
    followUp,
    hint: hintText || '',
    correction: misconception?.correction || '',
    socratic: misconception?.socratic || misconception?.correction || '',
    counter: challenge.counter?.text || '',
    quote: playerText && reason === 'progress' ? `You said "${shortQuote(playerText, 50)}". ` : '',
  };

  // What the live AI is required to preserve when it rephrases.
  const mustConvey = {
    open: 'Present the challenge claim confidently. Do not hint at the answer.',
    accept: 'Concede the challenge. Name what the student did well. Do not add new facts.',
    end: 'The student is out of attempts. End the challenge gracefully. The solution is shown separately.',
    counter: `Present this counterargument and ask the student to defend their position: "${slots.counter}"`,
    correction: character.mechanics.explainsMisconceptions
      ? `Correct this misconception briefly: ${slots.correction}`
      : `Challenge the misconception with a probing question: ${slots.socratic}`,
    hint: `Give this hint, and no more than this hint: ${slots.hint}`,
    answerRequest: 'Refuse to give the answer. Redirect the student to think about what is relevant.',
    answerRequestRepeat: 'Firmly refuse again and warn that asking for answers costs XP.',
    irrelevant: `The response was off-topic. Refocus the student with this question: ${followUp}`,
    defend: `The counterargument is still unanswered. Press with: ${followUp}`,
    evidence: 'The reasoning is sound but unsupported. Demand a concrete example or piece of evidence.',
    namedNotExplained: `The student named ${slots.concept} but did not explain it. Ask why it matters: ${followUp}`,
    progress: `Acknowledge the point the student just made, then ask this follow-up: ${followUp}`,
    question: `The student asked a useful question. Do not answer it directly. Respond with this guiding question: ${followUp}`,
    weak: `The response lacks reasoning. Push for the "why" using: ${followUp}`,
  }[key];

  return { action, reason, key, slots, mustConvey };
}

export function renderTemplate(character, brief) {
  let template = character.lines[brief.key];
  if (Array.isArray(template)) {
    // Deterministic variety: openings rotate by round, other lines by turn.
    const index = brief.action === 'OPEN' ? Number(brief.slots.round) - 1 : Number(brief.slots.variant);
    template = template[index % template.length];
  }
  const line = (template || '{followUp}').replace(/\{(\w+)\}/g, (_, k) => brief.slots[k] ?? '');
  const prefix = brief.action === 'HINT' && brief.reason === 'stuck' ? 'You look stuck. ' : '';
  return (prefix + line).replace(/\s{2,}/g, ' ').trim();
}
