// Validation of everything an AI (mock or live) returns. Nothing reaches the
// game engine without passing through here.

export class MalformedAIOutput extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'MalformedAIOutput';
  }
}

const STATUSES = ['absent', 'named', 'explained'];
const SCORE_KEYS = ['correctness', 'reasoning', 'evidence', 'critical_thinking', 'question_quality', 'understanding'];

function score(v, key) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new MalformedAIOutput(`score "${key}" is not a number`);
  return Math.round(Math.min(100, Math.max(0, n)));
}

function bool(v, key) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'false') return v === 'true';
  throw new MalformedAIOutput(`flag "${key}" is not a boolean`);
}

function text(v, max = 400) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new MalformedAIOutput('expected a string');
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Parse JSON that may be wrapped in a code fence. */
export function parseJSON(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') throw new MalformedAIOutput('empty response');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new MalformedAIOutput('response is not valid JSON');
  }
}

/**
 * Normalize a raw evaluation against the challenge it is about. Unknown
 * concept or misconception ids are dropped, so an AI can never award progress
 * on something that is not part of the verified challenge.
 */
export function validateEvaluation(raw, challenge) {
  const data = parseJSON(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new MalformedAIOutput('evaluation must be an object');

  const conceptIds = new Set(challenge.concepts.map((c) => c.id));
  const concepts = Object.fromEntries(challenge.concepts.map((c) => [c.id, 'absent']));
  const list = Array.isArray(data.concepts)
    ? data.concepts
    : data.concepts && typeof data.concepts === 'object'
      ? Object.entries(data.concepts).map(([id, status]) => ({ id, status }))
      : null;
  if (!list) throw new MalformedAIOutput('concepts missing');
  for (const item of list) {
    if (!item || !conceptIds.has(item.id)) continue;
    if (!STATUSES.includes(item.status)) throw new MalformedAIOutput(`bad concept status for ${item.id}`);
    concepts[item.id] = item.status;
  }

  const defense = data.defense_status ?? data.defense ?? 'absent';
  if (!STATUSES.includes(defense)) throw new MalformedAIOutput('bad defense status');

  const misconceptionIds = new Set(challenge.misconceptions.map((m) => m.id));
  const misconceptions = Array.isArray(data.misconceptions)
    ? [...new Set(data.misconceptions.filter((id) => misconceptionIds.has(id)))]
    : [];

  const scoreSource = data.scores && typeof data.scores === 'object' ? data.scores : data;
  const scores = Object.fromEntries(SCORE_KEYS.map((k) => [k, score(scoreSource[k], k)]));

  const flags = {
    answer_request: bool(data.answer_request, 'answer_request'),
    is_question: bool(data.is_question, 'is_question'),
    relevant: bool(data.relevant, 'relevant'),
  };

  return {
    concepts,
    defense,
    misconceptions,
    scores,
    flags,
    strengths: text(data.strengths),
    improve: text(data.improve),
    student_claim: text(data.student_claim, 160),
  };
}

/** Validate a character line: non-empty, bounded, plain text. */
export function validateLine(raw) {
  if (typeof raw !== 'string') throw new MalformedAIOutput('line must be text');
  let line = raw.trim().replace(/^["“]|["”]$/g, '').trim();
  if (!line) throw new MalformedAIOutput('empty line');
  if (line.length > 900) line = line.slice(0, 900).replace(/\s+\S*$/, '') + '…';
  return line;
}
