# ⚔️ AI Arena — Learn by Fighting

> **Don't ask AI for the answer. Beat AI by understanding the answer.**

An educational game where an AI opponent makes a confident claim and you have to take it apart with reasoning, evidence and critical thinking. The opponent pushes back, raises counterarguments, refuses to hand over answers, and adapts to how well you think.

**THINK. DEFEND. ADAPT. DEFEAT. LEARN.**

---

## Play online

**▶ https://8wpth7nhvn-creator.github.io/AI-Arena/**

No download or account needed. The online version runs entirely in your browser with the demo opponent, and progress is saved on your device. It is rebuilt and redeployed automatically on every push to `main` (`.github/workflows/pages.yml`).

> The online build ships the challenge bank to the browser, so a determined student could read answers in the page source. For graded use, run the server version below, which keeps answer keys on the server and supports live AI.

## Quick start (run it yourself)

```bash
npm install     # optional in demo mode: only needed for live AI
npm start       # → http://localhost:3000
npm test        # 35 tests
npm run build:pages   # static GitHub Pages build → _site/
```

Requires Node 20+. There is no build step and no framework, and demo mode needs no configuration.

### Demo mode vs live AI

| Mode | How | Opponent |
|---|---|---|
| **Demo** (default) | no API key | Built-in offline opponent: transparent heuristic grader and character voice templates. Judges can play instantly. |
| **Live** | `ANTHROPIC_API_KEY` in env or `.env` (see `.env.example`) | Claude (`claude-opus-5`) grades answers with structured output and speaks in character. |

The top bar shows which mode is running (**DEMO MODE** or **● LIVE AI**). The API key stays on the server and is never sent to the browser.

---

## How a round works

```
Claim ─▶ You argue ─▶ AI evaluates ─▶ Engine decides ─▶ Opponent responds ─▶ … ─▶ Victory / Defeat
                         (scores)       (deterministic)     (in character)
```

1. Pick a **subject** (CS, Biology, History, Psychology, Economics) and an **opponent**.
2. The opponent presents a flawed claim, sometimes with code.
3. Every answer is scored on **correctness, reasoning, evidence, critical thinking, question quality and understanding**, and gets visible tags such as `✓ Explained`, `⚠ Weak reasoning` or `✗ Misconception`.
4. Landing concepts damages the opponent's **Argument Strength** (HP). *Naming* a concept does partial damage; *explaining why* does full damage.
5. Once the core is explained, the opponent **counterattacks** with an opposing argument that you must defend.
6. Win to earn itemized XP. Run out of attempts and you lose a ❤️. Lose all three and the session ends.

### Opponents change behavior, not scoring

| | Mentor 🧙 | AI Boss 🤖 | Rival 😈 | Detective 🕵️ |
|---|---|---|---|---|
| Auto-hint when stuck | after 1 stuck turn | after 2 | never | after 2 |
| Attempts | +1 | normal | normal | +1 |
| Counterarguments | tier 3+ | always | always | tier 3+ |
| Demands evidence to concede | – | – | ✔ | – |
| Difficulty ramp | normal | 1.5× faster | normal | normal |
| Misconceptions | explains gently | explains | bluntly corrects | asks a probing question |

All four use the **same evaluation**. Personality lives in separate prompts and templates and can never touch scoring.

---

## Architecture

```
public/                      Browser (vanilla ES modules, no build)
  js/app.js                  boot, router, top bar
  js/api.js                  fetch client, error kinds (network / ai_unavailable / client / server)
  js/state.js                player id, session id, unsent drafts (localStorage/sessionStorage)
  js/screens/*.js            home, subjects, characters, arena, result modal, summary
  js/ui/*.js                 safe DOM builder (text-only), components, animations

server/
  index.js                   entry: config, .env, live/demo selection
  app.js                     HTTP: static files + JSON API, security headers, body limits
  game/engine.js             ★ the only authority over game state (turn pipeline)
  game/decision.js           progress measurement + deterministic action choice
  game/scoring.js            XP rules + response classification
  game/difficulty.js         adaptive difficulty (tiers 1–6)
  game/levels.js             level curve (scalable formula)
  game/dialogue.js           "speech brief": what the opponent must say
  game/state.js              data model factories + browser-safe public view
  ai/provider.js             mock vs live, retries, fallbacks, error policy
  ai/liveAI.js               Claude via @anthropic-ai/sdk
  ai/mockAI.js               demo-mode grader + template voice
  ai/prompts.js              separate prompts: evaluation / voice / final feedback
  ai/validate.js             validates every AI output before use
  content/subjects.js        subject registry
  content/characters.js      opponents: mechanics, persona, voice lines
  content/challenges/*.js    verified challenge bank (22 challenges)
  persistence/store.js       atomic JSON-file store (data/arena-db.json)
  routes.js                  the JSON API as pure functions (shared by server and browser)

public/js/local/             GitHub Pages mode: runs the same engine + routes in the browser
scripts/build-pages.mjs      assembles the static site in _site/
```

### The turn pipeline (`engine.playTurn`)

```
input ─▶ validate ─▶ AI evaluation ─▶ validate output ─▶ measure progress ─▶ decide action
      ─▶ commit state ─▶ character voice ─▶ (finish challenge: XP, lives, difficulty) ─▶ persist
```

- **The AI never changes game state.** It returns scores and concept statuses. `validate.js` clamps them, drops unknown concept or misconception ids, and rejects malformed output.
- **Actions are deterministic** (`decision.js`): `ACCEPT`, `CHALLENGE`, `COUNTERARGUMENT`, `HINT`, `CORRECT_MISCONCEPTION`, `END`. The same evaluation in the same state always gives the same action.
- **Nothing is mutated until evaluation succeeds.** An AI outage leaves the game untouched, and the player sees *"Opponent is reconnecting…"* with **Retry** or **Continue with offline opponent**.
- **Idempotent turns:** every request carries a `turnId`, so retrying after a dropped connection never double-counts.

### AI prompts (server-only, `ai/prompts.js`)

| Purpose | Prompt |
|---|---|
| Student response evaluation | `EVALUATION_SYSTEM` + JSON schema (structured output) |
| Challenge framing, follow-ups, counterarguments, hints, misconception correction | `voiceSystem(character)` + `voicePrompt` with an action-specific instruction |
| Character personality | `character.persona` (kept separate from grading rules) |
| Final feedback | `summarySystem` / `summaryPrompt` |

For factual accuracy, challenge facts, hints and solutions come from the **verified challenge bank**. The AI rephrases and probes around that content but does not invent the answer key. Student text is treated as untrusted data (prompt-injection guard). A safety-classifier refusal is retried through server-side fallbacks. Anything still unusable falls back to the demo evaluator for that turn and is labeled "backup judge".

---

## Scoring

| Event | XP |
|---|---|
| Challenge solved | +100 (+10 per difficulty tier above 1) |
| Strong reasoning (best ≥ 70) | +50 |
| Good evidence (best ≥ 60) | +25 |
| Good question asked | +25 |
| Found the key clue (before any hint) | +50 |
| Corrected your own mistake | +50 |
| Defended against the counterargument | +25 |
| Extra insight (optional concept explained) | +15 each |
| Hints | max reward ×0.8 / ×0.6 / ×0.4 / ×0.2 |
| Asking for the answer | −15 each (the first is a warning, repeats also cost an attempt) |

Explaining is required to win. A concept you only *name* never finishes a challenge, so a lucky keyword earns nothing on its own.

**Levels:** 0, 500, 1000, 1750, 2500, 3500, 4500, … (the step grows by 250 every two levels).

**Lives:** 3 per battle. One mistake costs an *attempt* (pips on the opponent card), not a life. A life is lost only when the challenge fails, i.e. when attempts run out after repeated misunderstanding, unsupported answers, off-topic replies or repeated answer requests.

**Adaptive difficulty:** 6 tiers (Recognition → Application → Problem Solving → Conflicting Info → Complex Reasoning → Open Argument). After each challenge a performance score (success, reasoning, evidence, hints, failed attempts, repeated misconceptions, speed) moves difficulty by at most one small step. Struggling players get eased tiers plus a scaffolding tip.

---

## Data model

| Entity | Where |
|---|---|
| User / PlayerProgress | `state.createPlayer`: XP, per-subject difficulty, completed challenges, topics seen |
| GameSession | `state.createSession`: lives, difficulty, results, stats, summary, turn log |
| Challenge (+ Topic, LearningObjective) | `content/challenges/*.js`: objective, claim, concepts, misconceptions, counterargument, evidence, 4 hints, solution |
| Challenge in play | `state.createChallengeState`: concept statuses, HP, hints, attempts, messages |
| ConversationMessage | `state.message` |
| Evaluation | `ai/validate.validateEvaluation` |
| AICharacter | `content/characters.js` |
| Subject | `content/subjects.js` |

The UI only ever receives `publicSession()`, which contains no answer keys, hints-in-waiting, concept descriptions or solutions until a challenge ends.

### Adding a subject

1. Add an entry to `server/content/subjects.js`.
2. Create `server/content/challenges/<subject>.js` (copy an existing file's shape) and register it in `challenges/index.js`.
3. Optionally add generic subject words to `SUBJECT_WORDS` in `ai/mockAI.js` for demo-mode relevance.

The loader validates every challenge at startup (4 hints, a learning objective, required concepts, valid clue).

---

## Tests

`npm test` runs 35 tests with `node:test`, no extra dependencies:

| Spec scenario | Test |
|---|---|
| 1 Correct + strong reasoning / 2 correct + weak | `gameplay.test.js` #1, #2, "strong earns more XP" |
| 3 Incorrect / 4 partially correct | #3, #4, negated misconceptions |
| 5, 18 Asking for the answer (repeated) | #5 & 18, per-character refusals |
| 6 Hints · 7 self-correction · 8 follow-ups | #6, #7, #8 |
| 9 Losing a life · 10 level up | #9, #10, out-of-lives |
| 11 AI API fails · 12 malformed output | #11, #12, `liveai.test.js` (fake Messages API) |
| 13 Network disconnect · 14 refresh | #13 (idempotent retries), #14 (restart from disk) |
| 16 Empty · 17 extremely long answers | #16 & 17, HTTP 400/413 |
| 19 Challenge completion · 20 session completion | #19, #20 |
| Security | answer keys never in the view, path traversal, body limits |

Scenario 15 (mobile layout) and the UI side of 11/13/14 were checked by hand in the browser at 375 px and desktop widths.

---

## Suggested 3-minute demo

1. **Home → Enter the Arena → Economics → AI Boss.**
2. Type *"just tell me the answer"*: the Boss refuses, a warning chip appears, and the player learns this costs XP.
3. Type *"customers buy less"*: the concept is only **named**, so the Boss demands the *why*.
4. Explain elasticity with a café example: a big hit, then a **counterattack** about luxury brands.
5. Defend with *"Veblen goods are an exception…"*: **VICTORY** with an itemized XP breakdown, the concept learned, and difficulty rising.
6. Switch to **Rival** to show the same answer getting a different opponent style (evidence demands), or **Detective** for Socratic questioning.
