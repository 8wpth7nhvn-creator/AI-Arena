// The AI provider the engine talks to. It hides mock vs live and applies the
// error policy:
//   - evaluate(): malformed output is retried once, then falls back to the
//     demo evaluator. If the service is unreachable it throws
//     AIUnavailableError so the game can show "reconnecting" WITHOUT changing
//     any state (the player never loses a life to a technical problem).
//   - speak()/summarize(): never throw. Any failure falls back to the
//     character's template voice.

import { createMockAI } from './mockAI.js';
import { AIUnavailableError } from './liveAI.js';
import { validateEvaluation, validateLine, MalformedAIOutput } from './validate.js';

export { AIUnavailableError };

export function createProvider({ live = null, mock = createMockAI(), logger = console } = {}) {
  const warn = (msg, err) => logger.warn?.(`[ai] ${msg}${err ? `: ${err.message}` : ''}`);

  return {
    mode: live ? 'live' : 'demo',
    model: live?.model || null,

    async evaluate(ctx, { forceMock = false } = {}) {
      if (live && !forceMock) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const raw = await live.evaluate(ctx);
            return { ...validateEvaluation(raw, ctx.challenge), source: 'live' };
          } catch (err) {
            if (err instanceof AIUnavailableError) throw err;
            if (!(err instanceof MalformedAIOutput)) {
              // Unexpected error: treat as an outage so the turn can be retried.
              warn('unexpected evaluation error', err);
              throw new AIUnavailableError('The AI opponent hit an unexpected error.', err);
            }
            warn(`malformed evaluation (attempt ${attempt})`, err);
          }
        }
        const raw = await mock.evaluate(ctx);
        return { ...validateEvaluation(raw, ctx.challenge), source: 'fallback' };
      }
      const raw = await mock.evaluate(ctx);
      return { ...validateEvaluation(raw, ctx.challenge), source: 'mock' };
    },

    async speak(ctx, { forceMock = false } = {}) {
      if (live && !forceMock) {
        try {
          return { text: validateLine(await live.speak(ctx)), source: 'live' };
        } catch (err) {
          warn('voice fell back to template', err);
        }
      }
      return { text: validateLine(await mock.speak(ctx)), source: 'mock' };
    },

    async summarize(ctx, { forceMock = false } = {}) {
      if (live && !forceMock) {
        try {
          return validateLine(await live.summarize(ctx));
        } catch (err) {
          warn('summary fell back to template', err);
        }
      }
      return validateLine(await mock.summarize(ctx));
    },
  };
}
