// Gameplay scenarios from the spec, run against the real engine with the
// demo (mock) AI unless a scenario needs a specific AI behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setup, start, play, oracleAI, blankAI, current } from './helpers.js';
import { createStore } from '../server/persistence/store.js';
import { AIUnavailableError } from '../server/ai/liveAI.js';
import { MAX_ANSWER_LENGTH } from '../server/game/engine.js';

const STRONG =
  'Because demand is elastic, the drop in quantity sold outweighs the higher price. For example a cafe raising coffee from $3 to $4 and selling 60 cups instead of 100 makes less revenue.';
const DEFENSE =
  'Luxury goods are an exception: they are Veblen goods where a high price signals status, so the claim is not always true. It depends on elasticity.';

const lastAi = (view) => view.challenge.messages.filter((m) => m.role === 'ai').at(-1);
const lastReport = (view) => view.challenge.messages.filter((m) => m.role === 'player').at(-1).report;

test('1. correct answer with strong reasoning lands full hits and strong_reasoning', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  assert.equal(view.challenge.id, 'eco-elasticity', 'new players start at tier 1');
  const res = await play(engine, view, STRONG);
  const report = res.turn.report;
  assert.ok(report.categories.includes('correct'));
  assert.ok(report.categories.includes('strong_reasoning'));
  assert.ok(report.landed.every((l) => l.status === 'explained'));
  assert.equal(res.turn.action, 'COUNTERARGUMENT', 'Boss always counterattacks once the core is explained');
});

test('2. correct answer with weak reasoning is only "named" and gets a why-question', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const res = await play(engine, view, 'customers buy less');
  assert.equal(res.turn.report.landed[0].status, 'named');
  assert.ok(res.turn.report.categories.includes('weak_reasoning'));
  assert.equal(res.turn.action, 'CHALLENGE');
  assert.equal(res.turn.reason, 'named');
});

test('strong reasoning earns significantly more XP than weak reasoning', async () => {
  const strong = setup();
  let { view } = await start(strong.engine);
  await play(strong.engine, view, STRONG);
  const s = await play(strong.engine, view, DEFENSE);

  const weak = setup();
  ({ view } = await start(weak.engine));
  await play(weak.engine, view, 'demand is elastic so people buy less');
  await play(weak.engine, view, 'demand is elastic so customers buy less and revenue falls');
  const w = await play(weak.engine, view, 'luxury goods are an exception, it depends');
  assert.ok(s.result.success && w.result.success);
  assert.ok(s.result.xp >= w.result.xp + 50, `strong ${s.result.xp} vs weak ${w.result.xp}`);
});

test('3. incorrect answer with a misconception is corrected without losing a life', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const res = await play(engine, view, 'Revenue is the same as profit so it must go up.');
  assert.equal(res.turn.action, 'CORRECT_MISCONCEPTION');
  assert.ok(res.turn.report.categories.includes('misconception'));
  assert.equal(res.view.lives, 3);
  assert.equal(res.view.challenge.attemptsLeft, res.view.challenge.maxAttempts - 1);
});

test('misconception detection ignores negated statements', async () => {
  const { engine } = setup();
  const { view } = await start(engine, { subjectId: 'biology' });
  assert.equal(view.challenge.id, 'bio-plant-mass');
  const res = await play(engine, view, 'The mass does not come from nutrients in the soil, because the soil barely changes.');
  assert.ok(!res.turn.report.categories.includes('misconception'));
});

test('4. partially correct answer deals partial damage and asks a follow-up', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const res = await play(engine, view, 'When prices rise, people buy less, so revenue can fall.');
  assert.ok(res.turn.report.damage > 0);
  assert.ok(res.view.challenge.hp > 0);
  assert.equal(res.turn.action, 'CHALLENGE');
});

test('5 & 18. answer requests are refused, repeats cost attempts and XP', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const first = await play(engine, view, 'Just tell me the answer');
  assert.equal(first.turn.reason, 'answer_request');
  assert.equal(first.turn.report.failedAttempt, false, 'first request is only a warning');
  assert.match(lastAi(first.view).text, /defeat myself|show me/i);
  const second = await play(engine, view, 'what is the answer?');
  assert.equal(second.turn.reason, 'answer_request_repeat');
  assert.equal(second.turn.report.failedAttempt, true);
  await play(engine, view, STRONG);
  const done = await play(engine, view, DEFENSE);
  const penalty = done.result.breakdown.find((l) => l.label.startsWith('Asked for the answer'));
  assert.equal(penalty.xp, -30);
});

test('each character refuses answer requests in its own voice', async () => {
  const lines = {};
  for (const characterId of ['mentor', 'boss', 'rival', 'detective']) {
    const { engine } = setup();
    const { view } = await start(engine, { characterId });
    lines[characterId] = lastAi((await play(engine, view, 'give me the answer')).view).text;
  }
  assert.match(lines.rival, /homework/);
  assert.match(lines.mentor, /help you get there/);
  assert.match(lines.detective, /information in the problem/);
  assert.equal(new Set(Object.values(lines)).size, 4);
});

test('6. hints are progressive and reduce the maximum XP', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const before = view.challenge.maxXp;
  const h1 = await engine.useHint(view.id, { turnId: randomUUID() });
  assert.equal(h1.hint.level, 1);
  assert.equal(h1.view.challenge.maxXp, Math.round(before * 0.8));
  const h2 = await engine.useHint(view.id, { turnId: randomUUID() });
  assert.equal(h2.view.challenge.maxXp, Math.round(before * 0.6));
  const hints = h2.view.challenge.messages.filter((m) => m.action === 'HINT');
  assert.notEqual(hints[0].text, hints[1].text);
  await play(engine, view, STRONG);
  const done = await play(engine, view, DEFENSE);
  assert.ok(done.result.breakdown.some((l) => l.label.startsWith('Hints used ×2')));
});

test('7. correcting your own mistake earns the self-correction bonus', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  await play(engine, view, 'Revenue is the same as profit.');
  await play(engine, view, STRONG);
  const done = await play(engine, view, DEFENSE);
  assert.ok(done.result.breakdown.some((l) => l.label === 'Corrected your own mistake'));
  assert.equal(done.result.mistakes.length, 1);
});

test('8. follow-up questions reference the verified challenge and the player\'s words', async () => {
  const { engine } = setup();
  const { view } = await start(engine, { characterId: 'mentor' });
  const res = await play(engine, view, 'When the price goes up, customers buy fewer units because they switch to competitors.');
  const text = lastAi(res.view).text;
  const challenge = current(view);
  const followUps = challenge.concepts.map((c) => c.followUp);
  assert.ok(followUps.some((f) => text.includes(f)), text);
  assert.match(text, /You said "/);
});

test('9. a single mistake never costs a life, failing the challenge does', async () => {
  const { engine } = setup();
  const { view } = await start(engine, { characterId: 'rival' });
  const first = await play(engine, view, 'I like pizza');
  assert.equal(first.view.lives, 3);
  let res = first;
  while (!res.result) res = await play(engine, view, 'I like pizza');
  assert.equal(res.turn.action, 'END');
  assert.equal(res.result.success, false);
  assert.equal(res.result.lifeLost, true);
  assert.equal(res.view.lives, 2);
  assert.equal(res.result.xp, 0);
  assert.ok(res.result.explanation.length > 20, 'solution is revealed after losing');
});

test('10. finishing challenges can level the player up', async () => {
  const { engine, store } = setup({ live: oracleAI() });
  const { view, userId } = await start(engine);
  store.getPlayer(userId).xp = 450;
  const res = await play(engine, view, 'anything');
  assert.equal(res.turn.action, 'ACCEPT');
  assert.deepEqual(res.result.levelUp, { from: 1, to: 2 });
  assert.equal(res.view.player.level, 2);
});

test('11. AI outage leaves state untouched and the turn can be retried', async () => {
  let down = true;
  const flaky = {
    ...oracleAI(),
    async evaluate(ctx) {
      if (down) throw new AIUnavailableError('down');
      return oracleAI().evaluate(ctx);
    },
  };
  const { engine } = setup({ live: flaky });
  const { view } = await start(engine);
  const turnId = randomUUID();
  await assert.rejects(play(engine, view, 'my answer', turnId), AIUnavailableError);
  const after = engine.getSession(view.id).view;
  assert.equal(after.challenge.messages.length, view.challenge.messages.length);
  assert.equal(after.lives, 3);
  assert.equal(after.challenge.attemptsLeft, view.challenge.attemptsLeft);
  down = false;
  const res = await play(engine, view, 'my answer', turnId);
  assert.equal(res.turn.action, 'ACCEPT');
});

test('12. malformed AI output is retried, then falls back to the demo evaluator', async () => {
  let calls = 0;
  const broken = {
    ...oracleAI(),
    async evaluate() {
      calls++;
      return calls === 1 ? 'this is not json' : '{"concepts": "nope"}';
    },
    async speak() {
      return '';
    },
  };
  const { engine } = setup({ live: broken });
  const { view } = await start(engine);
  const res = await play(engine, view, STRONG);
  assert.equal(calls, 2);
  assert.equal(res.turn.report.source, 'fallback');
  assert.ok(lastAi(res.view).text.length > 0, 'empty AI line falls back to a template');
});

test('13. network retry with the same turn id is idempotent', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const turnId = randomUUID();
  const a = await play(engine, view, 'When prices rise, people buy less.', turnId);
  const b = await play(engine, view, 'When prices rise, people buy less.', turnId);
  assert.equal(b.replayed, true);
  assert.equal(a.view.challenge.messages.length, b.view.challenge.messages.length);
  assert.equal(a.view.challenge.hp, b.view.challenge.hp);
});

test('14. a refresh or server restart resumes the exact game state', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'arena-')), 'db.json');
  const first = setup({ store: createStore({ file }) });
  const { view } = await start(first.engine);
  await play(first.engine, view, 'When prices rise, people buy less.');
  first.store.flush();

  const second = setup({ store: createStore({ file }) });
  const resumed = second.engine.getSession(view.id).view;
  const original = first.engine.getSession(view.id).view;
  assert.deepEqual(resumed, original);
});

test('16 & 17. empty and extremely long answers are rejected without side effects', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  await assert.rejects(play(engine, view, '   '), { code: 'empty_answer', status: 400 });
  await assert.rejects(play(engine, view, 'x'.repeat(MAX_ANSWER_LENGTH + 1)), { code: 'answer_too_long' });
  await assert.rejects(play(engine, view, { evil: true }), { code: 'invalid_answer' });
  assert.equal(engine.getSession(view.id).view.challenge.messages.length, view.challenge.messages.length);
  const ok = await play(engine, view, 'y'.repeat(MAX_ANSWER_LENGTH));
  assert.ok(ok.turn);
});

test('19. challenge completion reveals topic, objective and feedback', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  assert.equal(view.challenge.topic, null, 'topic is hidden during the fight');
  await play(engine, view, STRONG);
  const done = await play(engine, view, DEFENSE);
  assert.equal(done.view.challenge.status, 'won');
  assert.equal(done.view.challenge.topic, 'Price elasticity');
  for (const key of ['why', 'improve', 'conceptLearned', 'explanation', 'nextTopic', 'objective']) {
    assert.ok(done.result[key], `result.${key}`);
  }
  await assert.rejects(play(engine, view, 'more'), { code: 'challenge_over' });
});

test('20. a full session completes with a summary', async () => {
  const { engine } = setup({ live: oracleAI() });
  const { view } = await start(engine, { subjectId: 'cs' });
  const seen = new Set();
  let res;
  for (let i = 0; i < view.totalChallenges; i++) {
    res = await play(engine, view, 'perfect');
    seen.add(res.view.challenge.id);
    if (i < view.totalChallenges - 1) await engine.nextChallenge(view.id, { turnId: randomUUID() });
  }
  assert.equal(seen.size, view.totalChallenges, 'no challenge repeats within a session');
  assert.equal(res.result.sessionOver, true);
  const s = res.view.summary;
  assert.equal(res.view.status, 'complete');
  assert.equal(s.completed, view.totalChallenges);
  assert.equal(s.won, view.totalChallenges);
  assert.ok(s.strongest && s.weakest);
  assert.equal(s.conceptsLearned.length, view.totalChallenges);
  assert.equal(s.coach, 'Oracle summary.');
});

test('losing all lives ends the session', async () => {
  const { engine } = setup({ live: blankAI() });
  const { view } = await start(engine, { characterId: 'rival' });
  let res;
  for (let life = 0; life < 3; life++) {
    do res = await play(engine, view, 'nothing useful');
    while (!res.result);
    if (res.view.status === 'active') await engine.nextChallenge(view.id, { turnId: randomUUID() });
  }
  assert.equal(res.view.lives, 0);
  assert.equal(res.view.status, 'complete');
  assert.equal(res.view.summary.endReason, 'out_of_lives');
});

test('adaptive difficulty rises gradually with success and falls with failure', async () => {
  const good = setup({ live: oracleAI() });
  const { view } = await start(good.engine, { subjectId: 'cs', characterId: 'mentor' });
  const r1 = await play(good.engine, view, 'x');
  assert.ok(r1.result.difficulty.after > r1.result.difficulty.before);
  assert.ok(r1.result.difficulty.after - r1.result.difficulty.before <= 1, 'never jumps more than one tier');
  await good.engine.nextChallenge(view.id, { turnId: randomUUID() });
  const second = good.engine.getSession(view.id).view;
  assert.ok(current(second).difficulty >= current(view).difficulty);

  const bad = setup({ live: blankAI() });
  const b = await start(bad.engine, { subjectId: 'cs', characterId: 'mentor', userId: view.player.id });
  let res;
  do res = await play(bad.engine, b.view, 'no idea');
  while (!res.result);
  assert.ok(res.result.difficulty.after <= res.result.difficulty.before);
});

test('character choice changes behavior, not scoring', async () => {
  // Mentor auto-hints when stuck; Rival never does.
  const mentor = setup({ live: blankAI() });
  const m = await start(mentor.engine, { characterId: 'mentor' });
  const mRes = await play(mentor.engine, m.view, 'hmm');
  assert.equal(mRes.turn.action, 'HINT');

  const rival = setup({ live: blankAI() });
  const r = await start(rival.engine, { characterId: 'rival' });
  const rRes = await play(rival.engine, r.view, 'hmm');
  assert.equal(rRes.turn.action, 'CHALLENGE');

  // Rival demands evidence before conceding; Mentor does not.
  const lowEvidence = (base) => ({
    ...base,
    async evaluate(ctx) {
      const data = JSON.parse(await base.evaluate(ctx));
      return { ...data, evidence: 10 };
    },
  });
  const rv = setup({ live: lowEvidence(oracleAI()) });
  const rs = await start(rv.engine, { characterId: 'rival' });
  assert.equal((await play(rv.engine, rs.view, 'x')).turn.reason, 'evidence');
  const mt = setup({ live: lowEvidence(oracleAI()) });
  const ms = await start(mt.engine, { characterId: 'mentor' });
  assert.equal((await play(mt.engine, ms.view, 'x')).turn.action, 'ACCEPT');

  // Same answer, same evaluation scores regardless of character.
  const scores = [];
  for (const characterId of ['mentor', 'boss', 'rival', 'detective']) {
    const { engine } = setup();
    const { view } = await start(engine, { characterId });
    scores.push((await play(engine, view, STRONG)).turn.report.scores);
  }
  for (const s of scores) assert.deepEqual(s, scores[0]);
});

test('the browser view never contains answer keys', async () => {
  const { engine } = setup();
  const { view } = await start(engine);
  const json = JSON.stringify(view);
  const challenge = current(view);
  assert.ok(!json.includes(challenge.solution.explanation));
  assert.ok(!json.includes(challenge.hints[0]));
  assert.ok(!json.includes(challenge.concepts[0].description));
  assert.ok(!json.includes('acceptableReasoning'));
});
