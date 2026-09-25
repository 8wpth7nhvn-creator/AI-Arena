import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelInfo, levelStart } from '../server/game/levels.js';
import { validateEvaluation, validateLine, MalformedAIOutput } from '../server/ai/validate.js';
import { getChallenge, challengesForSubject, pickChallenge } from '../server/content/challenges/index.js';
import { SUBJECTS } from '../server/content/subjects.js';
import { nextDifficulty } from '../server/game/difficulty.js';
import { createApp } from '../server/app.js';
import { setup } from './helpers.js';

test('level thresholds match the spec and keep scaling', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(levelStart), [0, 500, 1000, 1750, 2500]);
  assert.equal(levelInfo(499).level, 1);
  assert.equal(levelInfo(500).level, 2);
  assert.equal(levelInfo(1420).level, 3);
  assert.equal(levelInfo(1420).nextLevelXp, 1750);
  assert.ok(levelInfo(1_000_000).level > 20);
});

test('every subject has challenges that span several difficulties', () => {
  for (const s of SUBJECTS) {
    const pool = challengesForSubject(s.id);
    assert.ok(pool.length >= 4, s.id);
    assert.ok(new Set(pool.map((c) => c.difficulty)).size >= 3, s.id);
    for (const c of pool) {
      assert.equal(c.hints.length, 4);
      assert.ok(c.objective && c.solution.summary && c.solution.explanation);
    }
  }
  assert.ok(challengesForSubject('cs').length >= 5);
});

test('challenge picking prefers the closest difficulty and unseen challenges', () => {
  assert.equal(pickChallenge('cs', 1).difficulty, 1);
  const next = pickChallenge('cs', 2, { exclude: ['cs-loop-index'] });
  assert.equal(next.id, 'cs-scope');
});

test('difficulty moves in small steps and stays in range', () => {
  assert.equal(nextDifficulty(1, 1), 1.5);
  assert.equal(nextDifficulty(1, 0), 1);
  assert.equal(nextDifficulty(6, 1), 6);
  assert.equal(nextDifficulty(3, 0.1), 2.5);
});

test('evaluation validation clamps scores and drops unknown ids', () => {
  const ch = getChallenge('eco-elasticity');
  const ev = validateEvaluation(
    {
      concepts: [
        { id: 'elasticity', status: 'explained' },
        { id: 'made_up', status: 'explained' },
      ],
      defense_status: 'absent',
      misconceptions: ['revenue_is_profit', 'hacked'],
      correctness: 150,
      reasoning: -5,
      evidence: '40',
      critical_thinking: 0,
      question_quality: 0,
      understanding: 50,
      is_question: false,
      answer_request: false,
      relevant: true,
    },
    ch,
  );
  assert.equal(ev.concepts.elasticity, 'explained');
  assert.equal(ev.concepts.made_up, undefined);
  assert.deepEqual(ev.misconceptions, ['revenue_is_profit']);
  assert.equal(ev.scores.correctness, 100);
  assert.equal(ev.scores.reasoning, 0);
  assert.equal(ev.scores.evidence, 40);
});

test('malformed evaluations are rejected', () => {
  const ch = getChallenge('eco-elasticity');
  assert.throws(() => validateEvaluation('nope', ch), MalformedAIOutput);
  assert.throws(() => validateEvaluation({ concepts: [] }, ch), MalformedAIOutput);
  assert.throws(
    () => validateEvaluation({ concepts: [{ id: 'elasticity', status: 'mastered' }] }, ch),
    MalformedAIOutput,
  );
  assert.throws(() => validateLine(''), MalformedAIOutput);
  assert.ok(validateLine('x'.repeat(5000)).length < 1000);
});

async function withServer(fn) {
  const { engine, ai } = setup();
  const server = createApp({ engine, ai, publicDir: new URL('../public', import.meta.url).pathname, logger: { warn() {}, error() {} } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('HTTP API: plays a turn, validates input, hides secrets', async () => {
  await withServer(async (base) => {
    const post = (path, body) =>
      fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.mode, 'demo');

    const { player } = await (await post('/api/player', {})).json();
    const started = await (await post('/api/sessions', { userId: player.id, subjectId: 'cs', characterId: 'detective' })).json();
    const id = started.view.id;

    const empty = await post(`/api/sessions/${id}/turn`, { turnId: crypto.randomUUID(), message: '' });
    assert.equal(empty.status, 400);

    const bad = await fetch(`${base}/api/sessions/${id}/turn`, { method: 'POST', body: '{not json' });
    assert.equal(bad.status, 400);

    const huge = await post(`/api/sessions/${id}/turn`, { message: 'x'.repeat(20_000) });
    assert.equal(huge.status, 413);

    const ok = await post(`/api/sessions/${id}/turn`, { turnId: crypto.randomUUID(), message: 'input returns a string because it reads text' });
    assert.equal(ok.status, 200);
    const text = await ok.text();
    assert.ok(!text.includes('acceptableReasoning') && !text.includes('ANTHROPIC'));

    for (const path of ['/..%2fpackage.json', '/%2e%2e/package.json', '/../server/index.js']) {
      const body = await (await fetch(base + path)).text();
      assert.ok(!body.includes('ai-arena') && !body.includes('ANTHROPIC_API_KEY'), `served a file outside public/ for ${path}`);
    }

    const missing = await fetch(`${base}/api/sessions/00000000-0000-0000-0000-000000000000`);
    assert.equal(missing.status, 404);
  });
});
