// HTTP layer: static files + a small JSON API. No framework needed.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve, sep } from 'node:path';
import { GameError } from './game/engine.js';
import { createRoutes, dispatch } from './routes.js';

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

  const routes = createRoutes({ engine, ai });

  async function handleApi(req, res, pathname) {
    let body = {};
    try {
      if (req.method === 'POST') body = await readBody(req);
    } catch (err) {
      if (err instanceof GameError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      throw err;
    }
    const { status, json } = await dispatch(routes, req.method, pathname, body, logger);
    send(res, status, json);
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
