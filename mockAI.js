// Demo-mode AI. It needs no network. It evaluates answers with transparent
// heuristics (concept patterns from the challenge bank plus reasoning,
// evidence and critical-thinking markers) and speaks with character
// templates. It returns the same raw shape as the live AI, so both go
// through the same validation.

import { renderTemplate } from '../game/dialogue.js';

const NEGATION = /\b(not|no|never|isn'?t|doesn'?t|don'?t|aren'?t|wasn'?t|can'?t|cannot|won'?t|wouldn'?t|rather than|instead of|wrong|false|disagree|myth)\b/;
const ANSWER_REQUEST =
  /(what('?s| is) the (right |correct )?(answer|solution)|(tell|give|show) me (the |your )?(answer|solution)|just tell me|solve it for me|answer it for me|i give up|can you (just )?(tell|give) me|reveal the answer|what should i (say|write|answer))/;
const QUESTION_START = /^(what|why|how|does|do|is|are|could|would|can|should|if|when|where|which|who)\b/;
const CAUSAL = /\b(because|since|so|therefore|thus|hence|which means|this means|that means|leads? to|results? in|as a result|due to|causes?|caused|that'?s why|if|then|when|otherwise|makes?)\b/g;
const EVIDENCE = /(for example|for instance|e\.g\.|such as|like when|imagine|suppose|\d|experiment|stud(y|ies)|research|data|evidence|observ|measur|historians?|records?|documented|shows? that|tested|proof|trace)/g;
const CRITICAL = /\b(however|unless|depends|except|although|though|but|on the other hand|not always|not necessarily|alternatively|could also|another explanation|limitation|in some cases|only if|might|may|exception)\b/g;
const STOPWORDS = new Set(['about', 'there', 'their', 'which', 'would', 'could', 'should', 'because', 'always', 'simply', 'things', 'really', 'prove', 'wrong', 'these', 'those', 'where', 'while']);

const count = (text, re) => (text.match(re) || []).length;

function clauses(text) {
  return text.split(/[.!?;\n]+|\bbut\b|\bhowever\b/).map((s) => s.trim()).filter(Boolean);
}

function conceptHit(text, patterns) {
  return patterns.some((p) => p.test(text));
}

/** A misconception counts only in a clause that isn't negating it. */
function misconceptionHit(text, patterns) {
  return clauses(text).some((cl) =>
    patterns.some((p) => {
      const m = cl.match(p);
      if (!m) return false;
      const rest = cl.slice(0, m.index) + ' ' + cl.slice(m.index + m[0].length);
      return !NEGATION.test(rest);
    }),
  );
}

// Generic words that show a student is engaging with the subject, even vaguely.
const SUBJECT_WORDS = {
  cs: ['code', 'program', 'bug', 'error', 'line', 'loop', 'variable', 'function', 'python', 'crash', 'output', 'value'],
  economics: ['price', 'cost', 'money', 'market', 'demand', 'supply', 'buy', 'sell', 'economy'],
  biology: ['cell', 'plant', 'body', 'organism', 'species', 'gene', 'experiment', 'grow'],
  history: ['war', 'empire', 'cause', 'century', 'people', 'society', 'source', 'history'],
  psychology: ['people', 'person', 'behavior', 'behaviour', 'brain', 'mind', 'think', 'feel', 'study'],
};

function vocabulary(challenge) {
  const fromClaim = challenge.claim
    .toLowerCase()
    .split(/[^a-z0-9.']+/)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  return new Set([...challenge.keywords.map((k) => k.toLowerCase()), ...fromClaim, ...(SUBJECT_WORDS[challenge.subject] || [])]);
}

export function evaluateHeuristically({ challenge, cs, message }) {
  const text = message.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;

  const answer_request = ANSWER_REQUEST.test(text);
  const is_question = /\?/.test(text) || QUESTION_START.test(text);

  const causal = count(text, CAUSAL);
  const evidenceMarks = count(text, EVIDENCE);
  const criticalMarks = count(text, CRITICAL);

  const hits = challenge.concepts.filter((c) => conceptHit(text, c.patterns));
  const defenseHit = challenge.counter ? conceptHit(text, challenge.counter.defense.patterns) : false;
  const misconceptions = challenge.misconceptions.filter((m) => misconceptionHit(text, m.patterns)).map((m) => m.id);

  const vocab = vocabulary(challenge);
  const overlap = text.split(/[^a-z0-9.']+/).filter((w) => vocab.has(w)).length;
  const relevant =
    hits.length > 0 || defenseHit || misconceptions.length > 0 || overlap > 0 || (causal > 0 && words >= 6);

  let reasoning = 0;
  if (words >= 3) {
    // One causal link is enough to "explain" (>= 45); strong reasoning (>= 70)
    // needs several links and a developed argument.
    reasoning =
      (causal > 0 ? 35 : 0) +
      Math.min(causal, 3) * 8 +
      (words >= 25 ? 20 : words >= 12 ? 10 : words >= 6 ? 3 : 0) +
      Math.min(hits.length, 2) * 6;
  }
  reasoning = Math.min(100, reasoning);
  const evidence = Math.min(100, evidenceMarks * 35);
  const critical_thinking = Math.min(100, criticalMarks * 30);
  const explains = reasoning >= 45;

  const conceptStatus = challenge.concepts.map((c) => ({
    id: c.id,
    status: hits.includes(c) ? (explains ? 'explained' : 'named') : 'absent',
  }));

  // Correctness reflects cumulative coverage of required concepts after this turn.
  const required = challenge.concepts.filter((c) => c.required);
  const merged = (c) => {
    const now = conceptStatus.find((s) => s.id === c.id).status;
    const before = cs?.concepts?.[c.id] || 'absent';
    return now === 'explained' || before === 'explained' ? 1 : now === 'named' || before === 'named' ? 0.6 : 0;
  };
  const coverage = required.reduce((s, c) => s + merged(c), 0) / required.length;
  let correctness;
  if (hits.length || defenseHit) correctness = Math.round(50 + 50 * coverage) - (misconceptions.length ? 30 : 0);
  else if (misconceptions.length) correctness = 15;
  else correctness = relevant ? 25 : 0;

  const question_quality = is_question && !answer_request ? (relevant ? 60 + (words >= 7 ? 15 : 0) : 10) : 0;
  const understanding = hits.length ? Math.round((correctness + reasoning) / 2) : Math.min(correctness, reasoning);

  const strengths = [];
  for (const c of hits) if (explains) strengths.push(`You explained ${c.label.toLowerCase()}.`);
  if (reasoning >= 65) strengths.push('You connected cause and effect clearly.');
  if (evidence >= 60) strengths.push('You backed your claim with concrete evidence.');
  if (critical_thinking >= 60) strengths.push('You considered limits and alternatives.');
  const improve = [];
  if (reasoning < 45) improve.push('Explain *why*, not just *what*. Connect cause and effect with "because…".');
  if (evidence < 35) improve.push('Support your argument with a concrete example or evidence.');
  if (critical_thinking < 30) improve.push('Consider exceptions or limits to your argument.');

  return {
    concepts: conceptStatus,
    defense_status: defenseHit ? (explains || critical_thinking >= 40 ? 'explained' : 'named') : 'absent',
    misconceptions,
    correctness: Math.max(0, correctness),
    reasoning,
    evidence,
    critical_thinking,
    question_quality,
    understanding,
    is_question,
    answer_request,
    relevant,
    strengths: strengths.slice(0, 2).join(' '),
    improve: improve[0] || '',
    student_claim: message.slice(0, 120),
  };
}

export function createMockAI() {
  return {
    kind: 'mock',
    async evaluate(ctx) {
      return evaluateHeuristically(ctx);
    },
    async speak({ character, brief }) {
      return renderTemplate(character, brief);
    },
    async summarize({ character, stats }) {
      return defaultSummary(character, stats);
    },
  };
}

export function defaultSummary(character, stats) {
  const { completed, won, strongest, weakest } = stats;
  const lead =
    won === completed && completed > 0
      ? 'A flawless run.'
      : won > 0
        ? `You won ${won} of ${completed} challenges.`
        : 'A tough session, and every loss taught you something.';
  const skill = strongest ? ` Your strongest weapon was ${strongest.label.toLowerCase()}.` : '';
  const practice = weakest ? ` Next time, sharpen your ${weakest.label.toLowerCase()}: ${weakest.tip}` : '';
  const signoff = {
    mentor: ' I am proud of how you think.',
    boss: ' I will be waiting. Stronger.',
    rival: ' Do not get cocky.',
    detective: ' Our next case awaits.',
  }[character.id] || '';
  return lead + skill + practice + signoff;
}
