// Exercises the live Claude integration against a local fake of the
// Messages API: request shape, parsing, and error handling.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLiveAI, AIUnavailableError } from '../server/ai/liveAI.js';
import { createProvider } from '../server/ai/provider.js';
import { getChallenge } from '../server/content/challenges/index.js';
import { createChallengeState } from '../server/game/state.js';
import { quietLogger } from './helpers.js';

function fakeAnthropic(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = { url: req.url, headers: req.headers, body: JSON.parse(body || '{}') };
    requests.push(request);
    const { status = 200, json } = handler(request, requests.length);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  return new Promise((resolve) =>
    server.listen(0, () => resolve({ server, requests, baseURL: `http://127.0.0.1:${server.address().port}` })),
  );
}

const message = (text, stop_reason = 'end_turn') => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content: [{ type: 'text', text }],
  stop_reason,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const challenge = getChallenge('eco-elasticity');
const ctx = { challenge, cs: createChallengeState(challenge), message: 'Demand is elastic so revenue falls.' };
const goodEval = {
  concepts: [{ id: 'elasticity', status: 'explained' }],
  defense_status: 'absent',
  misconceptions: [],
  correctness: 80, reasoning: 75, evidence: 20, critical_thinking: 10, question_quality: 0, understanding: 78,
  is_question: false, answer_request: false, relevant: true,
  strengths: 'Good.', improve: 'Add an example.', student_claim: 'elastic demand',
};

test('live evaluation sends a structured-output request and parses the result', async () => {
  const fake = await fakeAnthropic(() => ({ json: message(JSON.stringify(goodEval)) }));
  try {
    const live = await createLiveAI({ apiKey: 'test-key', baseURL: fake.baseURL, maxRetries: 0 });
    const provider = createProvider({ live, logger: quietLogger });
    const ev = await provider.evaluate(ctx);
    assert.equal(ev.source, 'live');
    assert.equal(ev.concepts.elasticity, 'explained');

    const req = fake.requests[0];
    assert.equal(req.body.model, 'claude-opus-5');
    assert.equal(req.body.output_config.format.type, 'json_schema');
    assert.equal(req.body.output_config.effort, 'medium');
    assert.equal(req.body.fallbacks, 'default');
    assert.match(req.headers['anthropic-beta'], /server-side-fallback/);
    assert.equal(req.headers['x-api-key'], 'test-key');
    // The answer key is sent to the model, never the other way round.
    assert.match(req.body.messages[0].content, /Learning objective/);
    assert.match(req.body.messages[0].content, /latest_student_message/);
  } finally {
    fake.server.close();
  }
});

test('a 400 on the fallback beta retries once without it', async () => {
  const fake = await fakeAnthropic((req, n) =>
    n === 1
      ? { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'unknown beta' } } }
      : { json: message(JSON.stringify(goodEval)) },
  );
  try {
    const live = await createLiveAI({ apiKey: 'k', baseURL: fake.baseURL, maxRetries: 0 });
    const raw = await live.evaluate(ctx);
    assert.equal(JSON.parse(raw).correctness, 80);
    assert.equal(fake.requests.length, 2);
    assert.equal(fake.requests[1].body.fallbacks, undefined);
  } finally {
    fake.server.close();
  }
});

test('server errors surface as AIUnavailableError; refusals fall back safely', async () => {
  const down = await fakeAnthropic(() => ({ status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } }));
  try {
    const live = await createLiveAI({ apiKey: 'k', baseURL: down.baseURL, maxRetries: 0 });
    const provider = createProvider({ live, logger: quietLogger });
    await assert.rejects(provider.evaluate(ctx), AIUnavailableError);
    const line = await provider.speak({ character: { lines: { weak: 'fallback {followUp}' } }, brief: { action: 'CHALLENGE', key: 'weak', slots: { followUp: 'why?' } } });
    assert.equal(line.source, 'mock');
  } finally {
    down.server.close();
  }

  const refusing = await fakeAnthropic(() => ({ json: message('', 'refusal') }));
  try {
    const live = await createLiveAI({ apiKey: 'k', baseURL: refusing.baseURL, maxRetries: 0 });
    const provider = createProvider({ live, logger: quietLogger });
    const ev = await provider.evaluate(ctx);
    assert.equal(ev.source, 'fallback');
  } finally {
    refusing.server.close();
  }
});
