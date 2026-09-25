// In-browser backend for the static (GitHub Pages) build. It runs the exact
// same engine, content and routes as the Node server, with the demo opponent.
// The build script copies server/ next to this file's parent, which is why
// these imports point at ../../server/.

import { createEngine } from '../../server/game/engine.js';
import { createProvider } from '../../server/ai/provider.js';
import { createRoutes, dispatch } from '../../server/routes.js';
import { createLocalStore } from './localStore.js';

const ai = createProvider({ logger: { warn() {}, error: console.error } });
const engine = createEngine({ store: createLocalStore(), ai });
const routes = createRoutes({ engine, ai, hosted: true });

export async function handle(method, path, body) {
  // Round-trip through JSON so the UI gets copies, exactly like a network response.
  const result = await dispatch(routes, method, path, body ? JSON.parse(JSON.stringify(body)) : {}, console);
  return { status: result.status, json: JSON.parse(JSON.stringify(result.json)) };
}
