// The game engine: the single authority over game state.
//
// Turn pipeline:
//   input -> validate -> AI evaluation (validated) -> measure progress ->
//   deterministic action decision -> update state -> character voice ->
//   (maybe) finish challenge: XP, lives, adaptive difficulty -> persist
//
// Nothing is mutated until the evaluation has succeeded, so an AI outage
// leaves the game exactly as it was and the player can simply retry.

import { getSubject } from '../content/subjects.js';
import { getCharacter } from '../content/characters.js';
import { getChallenge, pickChallenge, challengesForSubject } from '../content/challenges/index.js';
import {
  createPlayer,
  createSession,
  createChallengeState,
  subjectProgress,
  message,
  publicSession,
  publicPlayer,
  CHALLENGES_PER_SESSION,
} from './state.js';
import { measureProgress, decideAction, ACTIONS } from './decision.js';
import { classify, challengeReward, maxAvailableXp } from './scoring.js';
import { performanceScore, nextDifficulty, needsScaffold, tierFor } from './difficulty.js';
import { levelInfo } from './levels.js';
import { buildBrief } from './dialogue.js';

export const MAX_ANSWER_LENGTH = 1500;
const TURN_LOG_LIMIT = 40;
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export class GameError extends Error {
  constructor(status, code, msg) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

const SKILLS = {
  reasoning: { label: 'Reasoning', tip: 'explain the "why" by linking cause and effect.' },
  evidence: { label: 'Evidence-based reasoning', tip: 'back every claim with a concrete example or data.' },
  critical_thinking: { label: 'Critical thinking', tip: 'look for exceptions, limits and alternative explanations.' },
  understanding: { label: 'Conceptual understanding', tip: 'make sure you can explain the core idea in your own words.' },
  correctness: { label: 'Accuracy', tip: 'double-check your facts before you commit to a claim.' },
  question_quality: { label: 'Asking good questions', tip: 'ask questions that narrow down the problem.' },
};

function uniqueSentences(texts) {
  const seen = new Set();
  return texts
    .flatMap((t) => t.match(/[^.!?]+[.!?]*/g) || [])
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/** One concrete tip, based on the player's best performance in the challenge. */
function improvementTip(cs, success) {
  if (cs.best.reasoning < 45) return 'Explain the "why": connect cause and effect with "because…" instead of stating conclusions.';
  if (cs.best.evidence < 60) return 'Strengthen your argument with a concrete example, number, or piece of evidence.';
  if (cs.best.critical_thinking < 50) return 'Show critical thinking: mention a limit, exception, or alternative explanation.';
  if (cs.hintsUsed > 0) return 'You relied on hints. Next time, try reasoning from the claim alone for the full reward.';
  if (cs.answerRequests > 0) return 'Treat the AI as a sparring partner, not an answer machine. Asking for answers cost you XP.';
  return success ? 'Flawless. Try a tougher opponent or a harder tier.' : 'Revisit the explanation below, then try again.';
}

export function validateAnswer(text) {
  if (typeof text !== 'string') throw new GameError(400, 'invalid_answer', 'Your answer must be text.');
  const trimmed = text.replace(/\u0000/g, '').trim();
  if (!trimmed) throw new GameError(400, 'empty_answer', 'Write something before you attack!');
  if (trimmed.length > MAX_ANSWER_LENGTH) {
    throw new GameError(400, 'answer_too_long', `Keep it under ${MAX_ANSWER_LENGTH} characters. Sharp arguments win.`);
  }
  return trimmed;
}

export function createEngine({ store, ai }) {
  const busy = new Set();

  function ensurePlayer(userId) {
    if (userId != null && !ID_PATTERN.test(userId)) throw new GameError(400, 'invalid_user', 'Invalid player id.');
    let player = userId ? store.getPlayer(userId) : null;
    if (!player) {
      player = createPlayer(userId || undefined);
      store.savePlayer(player);
    }
    return player;
  }

  function loadSession(sessionId) {
    if (!ID_PATTERN.test(String(sessionId))) throw new GameError(400, 'invalid_session', 'Invalid session id.');
    const session = store.getSession(sessionId);
    if (!session) throw new GameError(404, 'session_not_found', 'That battle no longer exists.');
    return session;
  }

  const view = (session) => publicSession(session, store.getPlayer(session.userId));

  /** Serialize work per session and make retried requests idempotent. */
  async function withSession(sessionId, turnId, fn) {
    const session = loadSession(sessionId);
    if (turnId != null && !ID_PATTERN.test(String(turnId))) throw new GameError(400, 'invalid_turn', 'Invalid turn id.');
    if (turnId && session.turnLog[turnId]) {
      return { ...session.turnLog[turnId], replayed: true, view: view(session) };
    }
    if (busy.has(session.id)) throw new GameError(409, 'busy', 'Your opponent is still responding.');
    busy.add(session.id);
    try {
      const player = store.getPlayer(session.userId);
      const result = (await fn(session, player)) || {};
      if (turnId) {
        session.turnLog[turnId] = result;
        const ids = Object.keys(session.turnLog);
        if (ids.length > TURN_LOG_LIMIT) delete session.turnLog[ids[0]];
      }
      store.saveSession(session);
      store.savePlayer(player);
      return { ...result, view: view(session) };
    } finally {
      busy.delete(session.id);
    }
  }

  async function say(session, brief, cs, challenge, playerText, opts) {
    const character = getCharacter(session.characterId);
    const { text, source } = await ai.speak({ character, brief, challenge, cs, playerText }, opts);
    return message('ai', text, { kind: brief.action.toLowerCase(), action: brief.action, source });
  }

  async function startChallenge(session, player, opts = {}) {
    const sp = subjectProgress(player, session.subjectId);
    const inSession = session.completed.map((c) => c.challengeId);
    const pool = challengesForSubject(session.subjectId);
    const everSolved = sp.completed.filter((id) => !inSession.includes(id));
    const exclude = pool.every((c) => [...inSession, ...everSolved].includes(c.id)) ? inSession : [...inSession, ...everSolved];
    const challenge = pickChallenge(session.subjectId, Math.round(session.difficulty), {
      exclude,
      seenTopics: sp.topicsSeen,
    });

    const cs = createChallengeState(challenge);
    session.current = cs;
    session.challengeNumber += 1;

    const brief = buildBrief({
      action: 'OPEN',
      character: getCharacter(session.characterId),
      challenge,
      round: session.challengeNumber,
    });
    cs.messages.push(await say(session, brief, cs, challenge, null, opts));
    cs.messages.push(message('system', challenge.claim, { kind: 'challenge', code: challenge.code || null }));
    if (needsScaffold(session)) {
      cs.messages.push(message('system', challenge.scaffold, { kind: 'tip' }));
    }
  }

  async function finishChallenge(session, player, success, opts) {
    const cs = session.current;
    const challenge = getChallenge(cs.challengeId);
    const character = getCharacter(session.characterId);
    cs.status = success ? 'won' : 'lost';

    const reward = challengeReward({ cs, challenge, difficulty: session.difficulty, success });
    const levelBefore = levelInfo(player.xp).level;
    player.xp += reward.total;
    session.xpEarned += reward.total;
    const levelAfter = levelInfo(player.xp).level;

    if (!success) session.lives = Math.max(0, session.lives - 1);

    const performance = performanceScore(cs, success);
    const difficultyBefore = session.difficulty;
    session.difficulty = nextDifficulty(session.difficulty, performance, character.mechanics);

    const sp = subjectProgress(player, session.subjectId);
    sp.difficulty = session.difficulty;
    if (success && !sp.completed.includes(challenge.id)) sp.completed.push(challenge.id);
    if (!sp.topicsSeen.includes(challenge.topic)) sp.topicsSeen.push(challenge.topic);
    if (success) session.stats.conceptsLearned.push({ topic: challenge.topic, summary: challenge.solution.summary });

    session.completed.push({
      challengeId: challenge.id,
      topic: challenge.topic,
      success,
      xp: reward.total,
      turns: cs.turns,
      hintsUsed: cs.hintsUsed,
      performance,
    });

    const sessionOver = session.lives <= 0 || session.challengeNumber >= session.totalChallenges;
    const upcoming = pickChallenge(session.subjectId, Math.round(session.difficulty), {
      exclude: session.completed.map((c) => c.challengeId),
    });
    const missing = challenge.concepts.filter((c) => c.required && cs.concepts[c.id] !== 'explained');

    cs.result = {
      success,
      xp: reward.total,
      breakdown: reward.breakdown,
      maxXp: maxAvailableXp(challenge, difficultyBefore, 0),
      why: success
        ? uniqueSentences(cs.strengths).slice(0, 2).join(' ') || 'You explained the key ideas and held your position.'
        : missing.length
          ? `You did not yet explain: ${missing.map((c) => c.label.toLowerCase()).join('; ')}.`
          : 'You understood the core idea but could not defend it under pressure.',
      improve: improvementTip(cs, success),
      topic: challenge.topic,
      objective: challenge.objective,
      conceptLearned: challenge.solution.summary,
      explanation: challenge.solution.explanation,
      mistakes: cs.misconceptionsSeen.map((id) => {
        const m = challenge.misconceptions.find((x) => x.id === id);
        return { label: m.label, correction: m.correction };
      }),
      nextTopic: success ? upcoming?.topic || challenge.topic : `Review: ${challenge.topic}`,
      lifeLost: !success,
      livesLeft: session.lives,
      difficulty: {
        before: difficultyBefore,
        after: session.difficulty,
        tierBefore: tierFor(difficultyBefore),
        tierAfter: tierFor(session.difficulty),
      },
      performance: Math.round(performance * 100),
      levelUp: levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null,
      sessionOver,
    };

    if (sessionOver) await completeSession(session, player, session.lives <= 0 ? 'out_of_lives' : 'finished', opts);
    return cs.result;
  }

  async function completeSession(session, player, reason, opts = {}) {
    session.status = 'complete';
    session.endReason = reason;
    if (player.activeSessionId === session.id) player.activeSessionId = null;

    const { scoreSums, scoreCounts } = session.stats;
    const skills = Object.entries(SKILLS)
      .filter(([k]) => scoreCounts[k] > 0)
      .map(([k, meta]) => ({ id: k, label: meta.label, tip: meta.tip, score: Math.round(scoreSums[k] / scoreCounts[k]) }))
      .sort((a, b) => b.score - a.score);
    const won = session.completed.filter((c) => c.success).length;
    const stats = {
      completed: session.completed.length,
      won,
      xp: session.xpEarned,
      lives: session.lives,
      strongest: skills[0] || null,
      weakest: skills.length > 1 ? skills[skills.length - 1] : null,
      concepts: session.stats.conceptsLearned.map((c) => c.summary),
      mistakes: session.stats.mistakes.map((m) => m.label),
    };
    const coach = await ai.summarize({ character: getCharacter(session.characterId), stats }, opts);

    session.summary = {
      endReason: reason,
      completed: stats.completed,
      won,
      xp: session.xpEarned,
      livesLeft: session.lives,
      skills,
      strongest: stats.strongest,
      weakest: stats.weakest,
      conceptsLearned: session.stats.conceptsLearned,
      mistakes: session.stats.mistakes,
      hintsUsed: session.stats.hintsUsed,
      answerRequests: session.stats.answerRequests,
      goodQuestions: session.stats.goodQuestions,
      recommendedDifficulty: tierFor(session.difficulty),
      difficultyChange: session.difficulty - session.startDifficulty,
      coach,
      results: session.completed,
    };
  }

  return {
    ensurePlayer: (userId) => publicPlayer(ensurePlayer(userId)),

    async startSession({ userId, subjectId, characterId, forceMock = false }) {
      if (!getSubject(subjectId)) throw new GameError(400, 'invalid_subject', 'Unknown subject.');
      if (!getCharacter(characterId)) throw new GameError(400, 'invalid_character', 'Unknown opponent.');
      const player = ensurePlayer(userId);

      const previous = player.activeSessionId && store.getSession(player.activeSessionId);
      if (previous && previous.status === 'active') {
        previous.status = 'complete';
        previous.endReason = 'abandoned';
        store.saveSession(previous);
      }

      const sp = subjectProgress(player, subjectId);
      const session = createSession({ userId: player.id, subjectId, characterId, difficulty: sp.difficulty });
      session.totalChallenges = Math.min(CHALLENGES_PER_SESSION, challengesForSubject(subjectId).length);
      await startChallenge(session, player, { forceMock });
      player.activeSessionId = session.id;
      player.sessionsPlayed += 1;
      store.saveSession(session);
      store.savePlayer(player);
      return { view: view(session) };
    },

    getSession(sessionId) {
      return { view: view(loadSession(sessionId)) };
    },

    playTurn(sessionId, { turnId, message: raw, forceMock = false }) {
      return withSession(sessionId, turnId, async (session, player) => {
        const text = validateAnswer(raw);
        const cs = session.current;
        if (session.status !== 'active' || !cs || cs.status !== 'active') {
          throw new GameError(409, 'challenge_over', 'This challenge is already over.');
        }
        const challenge = getChallenge(cs.challengeId);
        const character = getCharacter(session.characterId);
        const opts = { forceMock };

        // 1. Evaluate. May throw AIUnavailableError; nothing has changed yet.
        const ev = await ai.evaluate({ challenge, cs, message: text }, opts);

        // 2. Measure and decide (pure).
        const progress = measureProgress(cs, challenge, ev);
        const decision = decideAction({ cs, challenge, character, difficulty: session.difficulty, ev, progress });
        const categories = classify(ev);
        const counted = ev.flags.relevant && !ev.flags.answer_request;

        // 3. Commit state.
        const hadMisconception = cs.misconceptionsSeen.length > 0;
        cs.turns += 1;
        cs.concepts = progress.concepts;
        cs.defense = progress.defense;
        cs.hp = Math.max(0, cs.hp - progress.damage);

        if (counted) {
          for (const [k, v] of Object.entries(ev.scores)) {
            cs.best[k] = Math.max(cs.best[k], v);
            if (k === 'question_quality' && !ev.flags.is_question) continue;
            session.stats.scoreSums[k] += v;
            session.stats.scoreCounts[k] += 1;
          }
          if (ev.strengths && !cs.strengths.includes(ev.strengths)) cs.strengths.push(ev.strengths);
          if (ev.improve && !cs.improvements.includes(ev.improve)) cs.improvements.push(ev.improve);
        }
        for (const id of progress.newMisconceptions) {
          cs.misconceptionsSeen.push(id);
          const m = challenge.misconceptions.find((x) => x.id === id);
          session.stats.mistakes.push({ label: m.label, correction: m.correction });
        }
        cs.misconceptionRepeats += progress.repeatedMisconceptions.length;
        if (hadMisconception && progress.newlyExplained.length && !progress.newMisconceptions.length) cs.selfCorrected = true;
        if (
          challenge.clue &&
          cs.hintsUsed === 0 &&
          (progress.newlyExplained.includes(challenge.clue) || progress.newlyNamed.includes(challenge.clue))
        ) {
          cs.clueFound = true;
        }
        if (decision.goodQuestion && !ev.flags.answer_request) {
          cs.goodQuestions += 1;
          session.stats.goodQuestions += 1;
        }
        if (ev.flags.answer_request) {
          cs.answerRequests += 1;
          session.stats.answerRequests += 1;
        }
        if (decision.failed) {
          cs.failedAttempts += 1;
          cs.stuckStreak += 1;
        } else if (progress.any) {
          cs.stuckStreak = 0;
        }
        if (decision.action === ACTIONS.COUNTERARGUMENT) cs.counterIssued = true;
        if (decision.reason === 'evidence') cs.evidenceAsked = true;

        let hintText = null;
        if (decision.action === ACTIONS.HINT) {
          hintText = challenge.hints[cs.hintsUsed];
          cs.hintsUsed += 1;
          session.stats.hintsUsed += 1;
        }

        const misconception = ev.misconceptions.length
          ? challenge.misconceptions.find((m) => m.id === ev.misconceptions[0])
          : null;
        const report = {
          categories,
          scores: ev.scores,
          damage: progress.damage,
          landed: [...progress.newlyExplained, ...progress.newlyNamed].map((id) => {
            const c = challenge.concepts.find((x) => x.id === id);
            return { label: c.label, status: progress.concepts[id] };
          }),
          defended: progress.defenseGain ? progress.defense : null,
          misconception: misconception ? misconception.label : null,
          failedAttempt: decision.failed,
          source: ev.source,
        };
        cs.messages.push(message('player', text, { kind: 'answer', report }));

        // 4. Character voice (never throws; falls back to templates).
        const brief = buildBrief({
          action: decision.action,
          reason: decision.reason,
          character,
          challenge,
          target: decision.target,
          playerText: text,
          hintText,
          misconception,
          round: session.challengeNumber,
          variant: cs.turns,
        });
        const reply = await say(session, brief, cs, challenge, text, opts);
        if (hintText) reply.hintLevel = cs.hintsUsed;
        cs.messages.push(reply);

        // 5. Resolve the challenge if it ended.
        let result = null;
        if (decision.action === ACTIONS.ACCEPT) result = await finishChallenge(session, player, true, opts);
        if (decision.action === ACTIONS.END) result = await finishChallenge(session, player, false, opts);

        return { turn: { action: decision.action, reason: decision.reason, report }, result };
      });
    },

    useHint(sessionId, { turnId, forceMock = false }) {
      return withSession(sessionId, turnId, async (session) => {
        const cs = session.current;
        if (session.status !== 'active' || !cs || cs.status !== 'active') {
          throw new GameError(409, 'challenge_over', 'This challenge is already over.');
        }
        const challenge = getChallenge(cs.challengeId);
        if (cs.hintsUsed >= challenge.hints.length) throw new GameError(409, 'no_hints', 'No hints left. You have got this.');
        const hintText = challenge.hints[cs.hintsUsed];
        cs.hintsUsed += 1;
        session.stats.hintsUsed += 1;
        const brief = buildBrief({
          action: 'HINT',
          reason: 'requested',
          character: getCharacter(session.characterId),
          challenge,
          hintText,
          round: session.challengeNumber,
        });
        const reply = await say(session, brief, cs, challenge, null, { forceMock });
        reply.hintLevel = cs.hintsUsed;
        cs.messages.push(reply);
        return { hint: { level: cs.hintsUsed } };
      });
    },

    nextChallenge(sessionId, { turnId, forceMock = false }) {
      return withSession(sessionId, turnId, async (session, player) => {
        if (session.status !== 'active') throw new GameError(409, 'session_over', 'This session is complete.');
        if (session.current?.status === 'active') throw new GameError(409, 'challenge_active', 'Finish the current challenge first.');
        await startChallenge(session, player, { forceMock });
        return {};
      });
    },

    endSession(sessionId, { turnId, forceMock = false } = {}) {
      return withSession(sessionId, turnId, async (session, player) => {
        if (session.status === 'active') await completeSession(session, player, 'quit', { forceMock });
        return {};
      });
    },
  };
}
