// The JSON API as pure functions: (method, path, body) -> { status, json }.
// Used by the Node HTTP server (server/app.js) and, on GitHub Pages, by the
// in-browser backend (public/js/local/backend.js), so both behave identically.

import { SUBJECTS } from './content/subjects.js';
import { CHARACTERS, publicCharacter } from './content/characters.js';
import { GameError } from './game/engine.js';
import { AIUnavailableError } from './ai/errors.js';
import { TIERS } from './game/difficulty.js';

export function createRoutes({ engine, ai, hosted = false }) {
  const forceMock = (body) => body.forceMock === true;
  return [
    ['GET', /^\/api\/config$/, () => ({ mode: ai.mode, model: ai.model, hosted })],
    ['GET', /^\/api\/content$/, () => ({ subjects: SUBJECTS, characters: CHARACTERS.map(publicCharacter), tiers: TIERS })],
    ['POST', /^\/api\/player$/, (_, body) => ({ player: engine.ensurePlayer(body.userId ?? null) })],
    [
      'POST',
      /^\/api\/sessions$/,
      (_, body) =>
        engine.startSession({ userId: body.userId, subjectId: body.subjectId, characterId: body.characterId, forceMock: forceMock(body) }),
    ],
    ['GET', /^\/api\/sessions\/([^/]+)$/, ([id]) => engine.getSession(id)],
    [
      'POST',
      /^\/api\/sessions\/([^/]+)\/turn$/,
      ([id], body) => engine.playTurn(id, { turnId: body.turnId, message: body.message, forceMock: forceMock(body) }),
    ],
    ['POST', /^\/api\/sessions\/([^/]+)\/hint$/, ([id], body) => engine.useHint(id, { turnId: body.turnId, forceMock: forceMock(body) })],
    ['POST', /^\/api\/sessions\/([^/]+)\/next$/, ([id], body) => engine.nextChallenge(id, { turnId: body.turnId, forceMock: forceMock(body) })],
    ['POST', /^\/api\/sessions\/([^/]+)\/end$/, ([id], body) => engine.endSession(id, { turnId: body.turnId, forceMock: forceMock(body) })],
  ];
}

export function hasRoute(routes, method, path) {
  return routes.some(([m, re]) => m === method && re.test(path));
}

/** Run one request against the routes and map errors to HTTP-style responses. */
export async function dispatch(routes, method, path, body = {}, logger = console) {
  try {
    for (const [m, re, handler] of routes) {
      const match = path.match(re);
      if (!match || m !== method) continue;
      return { status: 200, json: await handler(match.slice(1).map(decodeURIComponent), body) };
    }
    return { status: 404, json: { error: { code: 'not_found', message: 'Unknown endpoint.' } } };
  } catch (err) {
    if (err instanceof GameError) return { status: err.status, json: { error: { code: err.code, message: err.message } } };
    if (err instanceof AIUnavailableError) {
      logger.warn?.(`[ai] unavailable: ${err.message}`);
      return { status: 503, json: { error: { code: 'ai_unavailable', message: 'Your opponent is reconnecting…', retryable: true } } };
    }
    logger.error?.(err);
    return { status: 500, json: { error: { code: 'server_error', message: 'Something went wrong. Your progress is saved.' } } };
  }
}
