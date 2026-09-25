import { randomUUID } from 'node:crypto';
import { createStore } from '../server/persistence/store.js';
import { createProvider } from '../server/ai/provider.js';
import { createEngine } from '../server/game/engine.js';
import { getChallenge } from '../server/content/challenges/index.js';

export const quietLogger = { warn() {}, error() {} };

export function setup({ live = null, store = createStore() } = {}) {
  const ai = createProvider({ live, logger: quietLogger });
  const engine = createEngine({ store, ai });
  return { engine, store, ai };
}

export async function start(engine, { subjectId = 'economics', characterId = 'boss', userId = randomUUID() } = {}) {
  const { view } = await engine.startSession({ userId, subjectId, characterId });
  return { view, userId };
}

export function play(engine, view, message, turnId = randomUUID()) {
  return engine.playTurn(view.id, { turnId, message });
}

/**
 * A fake "live" AI that grades every answer as a perfect, fully explained,
 * evidence-backed response for whatever challenge is in play.
 */
export function oracleAI() {
  return {
    kind: 'live',
    model: 'oracle',
    async evaluate({ challenge }) {
      return JSON.stringify({
        concepts: challenge.concepts.map((c) => ({ id: c.id, status: 'explained' })),
        defense_status: 'explained',
        misconceptions: [],
        correctness: 95,
        reasoning: 90,
        evidence: 80,
        critical_thinking: 80,
        question_quality: 0,
        understanding: 92,
        is_question: false,
        answer_request: false,
        relevant: true,
        strengths: 'Clear causal reasoning.',
        improve: 'Keep it up.',
        student_claim: 'perfect answer',
      });
    },
    async speak({ brief }) {
      return `[oracle ${brief.action}]`;
    },
    async summarize() {
      return 'Oracle summary.';
    },
  };
}

/** A fake AI that always returns an empty evaluation (nothing demonstrated). */
export function blankAI() {
  return {
    ...oracleAI(),
    async evaluate({ challenge }) {
      return {
        concepts: challenge.concepts.map((c) => ({ id: c.id, status: 'absent' })),
        defense_status: 'absent',
        misconceptions: [],
        correctness: 10,
        reasoning: 5,
        evidence: 0,
        critical_thinking: 0,
        question_quality: 0,
        understanding: 5,
        is_question: false,
        answer_request: false,
        relevant: true,
        strengths: '',
        improve: '',
        student_claim: '',
      };
    },
  };
}

export const current = (view) => getChallenge(view.challenge.id);
