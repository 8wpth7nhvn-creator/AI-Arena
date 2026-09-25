// The GitHub Pages build must contain only browser-safe modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const site = join(root, '_site');

function files(dir) {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

test('static build runs the game in the browser without Node or secrets', () => {
  execFileSync(process.execPath, [join(root, 'scripts/build-pages.mjs')], { stdio: 'ignore' });
  assert.match(readFileSync(join(site, 'index.html'), 'utf8'), /data-backend="local"/);
  assert.ok(existsSync(join(site, 'server/game/engine.js')));
  assert.ok(!existsSync(join(site, 'server/ai/liveAI.js')), 'the live AI client is not shipped');
  for (const file of files(site).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/from ['"]node:/.test(src), `${file} imports a Node module`);
    assert.ok(!src.includes('@anthropic-ai/sdk'), `${file} references the SDK`);
  }
});
