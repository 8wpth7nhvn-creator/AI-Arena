// Entry point: `npm start`.
// Demo mode (no setup): the built-in mock opponent is used.
// Live mode: set ANTHROPIC_API_KEY (environment or .env file) to play against Claude.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStore } from './persistence/store.js';
import { createProvider } from './ai/provider.js';
import { createEngine } from './game/engine.js';
import { createApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

// Minimal .env support so the key never has to live in code.
const envFile = join(projectRoot, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT) || 3000;
const wantLive = process.env.AI_MODE !== 'demo' && Boolean(process.env.ANTHROPIC_API_KEY);

let live = null;
if (wantLive) {
  try {
    const { createLiveAI } = await import('./ai/liveAI.js');
    live = await createLiveAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ARENA_MODEL || 'claude-opus-5',
      evalEffort: process.env.ARENA_EVAL_EFFORT || 'medium',
      voiceEffort: process.env.ARENA_VOICE_EFFORT || 'low',
      useFallbacks: process.env.ARENA_FALLBACKS !== 'off',
    });
  } catch (err) {
    console.warn(`[ai] live AI unavailable (${err.message}). Falling back to demo mode. Did you run npm install?`);
  }
}

const store = createStore({ file: process.env.ARENA_DB_PATH || join(projectRoot, 'data', 'arena-db.json') });
const ai = createProvider({ live });
const engine = createEngine({ store, ai });
const server = createApp({ engine, ai, publicDir: join(projectRoot, 'public') });

server.listen(PORT, () => {
  console.log(`\n  ⚔️  AI Arena running at http://localhost:${PORT}`);
  console.log(`     Mode: ${ai.mode === 'live' ? `LIVE AI (${ai.model})` : 'DEMO (mock opponent, no API key needed)'}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.flush();
    process.exit(0);
  });
}
