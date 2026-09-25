// HTTP layer: static files + a small JSON API. No framework needed.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, sep } from 'node:path';
import { SUBJECTS } from './content/subjects.js';
import { CHARACTERS, publicCharacter } from './content/characters.js';
import { GameError } from './game/engine.js';
import { AIUnavailableError } from './ai/provider.js';
import { TIERS } from './game/difficulty.js';

const MAX_BODY = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; script-src 'self'",
};

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(json);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new GameError(413, 'too_large', 'Request too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new GameError(400, 'bad_json', 'Malformed request.');
  }
}

export function createApp({ engine, ai, publicDir, logger = console }) {
  const root = resolve(publicDir);

  const routes = [
    ['GET', /^\/api\/config$/, () => ({ mode: ai.mode, model: ai.model })],
    [
      'GET',
      /^\/api\/content$/,
      () => ({ subjects: SUBJECTS, characters: CHARACTERS.map(publicCharacter), tiers: TIERS }),
    ],
    ['POST', /^\/api\/player$/, (_, body) => ({ player: engine.ensurePlayer(body.userId ?? null) })],
    [
      'POST',
      /^\/api\/sessions$/,
      (_, body) =>
        engine.startSession({
          userId: body.userId,
          subjectId: body.subjectId,
          characterId: body.characterId,
          forceMock: body.forceMock === true,
        }),
    ],
    ['GET', /^\/api\/sessions\/([^/]+)$/, ([id]) => engine.getSession(id)],
    [
      'POST',
      /^\/api\/sessions\/([^/]+)\/turn$/,
      ([id], body) => engine.playTurn(id, { turnId: body.turnId, message: body.message, forceMock: body.forceMock === true }),
    ],
    ['POST', /^\/api\/sessions\/([^/]+)\/hint$/, ([id], body) => engine.useHint(id, { turnId: body.turnId, forceMock: body.forceMock === true })],
    ['POST', /^\/api\/sessions\/([^/]+)\/next$/, ([id], body) => engine.nextChallenge(id, { turnId: body.turnId, forceMock: body.forceMock === true })],
    ['POST', /^\/api\/sessions\/([^/]+)\/end$/, ([id], body) => engine.endSession(id, { turnId: body.turnId, forceMock: body.forceMock === true })],
  ];

  async function handleApi(req, res, pathname) {
    try {
      for (const [method, re, handler] of routes) {
        const m = pathname.match(re);
        if (!m) continue;
        if (req.method !== method) continue;
        const body = method === 'POST' ? await readBody(req) : {};
        const result = await handler(m.slice(1).map(decodeURIComponent), body);
        return send(res, 200, result);
      }
      send(res, 404, { error: { code: 'not_found', message: 'Unknown endpoint.' } });
    } catch (err) {
      if (err instanceof GameError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      if (err instanceof AIUnavailableError) {
        logger.warn(`[ai] unavailable: ${err.message}`);
        return send(res, 503, {
          error: { code: 'ai_unavailable', message: 'Your opponent is reconnecting…', retryable: true },
        });
      }
      logger.error(err);
      send(res, 500, { error: { code: 'server_error', message: 'Something went wrong. Your progress is saved.' } });
    }
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      return res.end();
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      const body = await readFile(file);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      // SPA fallback: unknown non-file routes get the app shell.
      if (!extname(rel)) return serveStatic(res, '/');
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
    }
  }

  return createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, SECURITY_HEADERS);
      return res.end();
    }
    return serveStatic(res, pathname);
  });
}
