// Builds the static GitHub Pages site into _site/.
//   _site/            <- public/ (the UI)
//   _site/server/     <- the browser-safe engine, content and demo AI
// index.html gets data-backend="local", so the game runs fully in the browser.
//
// Usage: node scripts/build-pages.mjs   (then serve _site/ with any static server)

import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');

// Only modules that run in a browser. The live-AI client, HTTP server and
// file store stay out: there is no server (and no API key) on GitHub Pages.
const SERVER_FILES = [
  'routes.js',
  'game',
  'content',
  'ai/errors.js',
  'ai/provider.js',
  'ai/mockAI.js',
  'ai/validate.js',
];

rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'public'), out, { recursive: true });
for (const rel of SERVER_FILES) {
  const dest = join(out, 'server', rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, 'server', rel), dest, { recursive: true });
}

const indexPath = join(out, 'index.html');
const html = readFileSync(indexPath, 'utf8').replace('<html lang="en">', '<html lang="en" data-backend="local">');
if (!html.includes('data-backend="local"')) throw new Error('Could not mark index.html as a local build');
writeFileSync(indexPath, html);
writeFileSync(join(out, '.nojekyll'), ''); // serve files as-is, no Jekyll processing

console.log(`Built static site in ${out}`);
