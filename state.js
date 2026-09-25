// Data model factories and the public (browser-safe) view of game state.
//
// Model overview (see README "Data model"):
//   User/PlayerProgress  -> createPlayer()
//   GameSession          -> createSession()
//   ChallengeState       -> createChallengeState()  (a Challenge in play)
//   ConversationMessage  -> message()
//   Evaluation           -> produced by server/ai/validate.js
//   Challenge, Subject, Topic, LearningObjective -> server/content/*
//   AICharacter          -> server/content/characters.js

import { randomUUID } from 'node:crypto';
import { levelInfo } from './levels.js';
import { tierFor } from './difficulty.js';
import { getSubject } from '../content/subjects.js';
import { getCharacter, publicCharacter } from '../content/characters.js';
import { getChallenge } from '../content/challenges/index.js';
import { maxFailedAttempts, counterRequired } from './decision.js';
import { maxAvailableXp } from './scoring.js';

export const MAX_LIVES = 3;
export const CHALLENGES_PER_SESSION = 4;
export const DIMENSIONS = ['correctness', 'reasoning', 'evidence', 'critical_thinking', 'question_quality', 'understanding'];

const zeroScores = () => Object.fromEntries(DIMENSIONS.map((d) => [d, 0]));

export function createPlayer(id = randomUUID()) {
  return {
    id,
    createdAt: Date.now(),
    xp: 0,
    subjects: {}, // subjectId -> { difficulty, completed: [challengeId], topicsSeen: [] }
    sessionsPlayed: 0,
    activeSessionId: null,
  };
}

export function subjectProgress(player, subjectId) {
  player.subjects[subjectId] ??= { difficulty: 1, completed: [], topicsSeen: [] };
  return player.subjects[subjectId];
}

export function createSession({ userId, subjectId, characterId, difficulty }) {
  return {
    id: randomUUID(),
    userId,
    subjectId,
    characterId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active', // active | complete
    endReason: null, // finished | out_of_lives | quit
    lives: MAX_LIVES,
    difficulty,
    startDifficulty: difficulty,
    challengeNumber: 0,
    totalChallenges: CHALLENGES_PER_SESSION,
    xpEarned: 0,
    completed: [], // per-challenge results
    current: null, // ChallengeState
    stats: {
      scoreSums: zeroScores(),
      scoreCounts: zeroScores(),
      conceptsLearned: [],
      mistakes: [],
      hintsUsed: 0,
      answerRequests: 0,
      goodQuestions: 0,
    },
    summary: null,
    turnLog: {}, // turnId -> cached response, for idempotent retries
  };
}

export function createChallengeState(challenge) {
  return {
    challengeId: challenge.id,
    startedAt: Date.now(),
    status: 'active', // active | won | lost
    turns: 0,
    messages: [],
    concepts: Object.fromEntries(challenge.concepts.map((c) => [c.id, 'absent'])),
    defense: 'absent',
    counterIssued: false,
    evidenceAsked: false,
    hp: challenge.maxHp,
    hintsUsed: 0,
    answerRequests: 0,
    failedAttempts: 0,
    stuckStreak: 0,
    misconceptionsSeen: [],
    misconceptionRepeats: 0,
    selfCorrected: false,
    clueFound: false,
    goodQuestions: 0,
    best: zeroScores(),
    strengths: [],
    improvements: [],
    result: null,
  };
}

export function message(role, text, extra = {}) {
  return { id: randomUUID(), role, text, at: Date.now(), ...extra };
}

/** The only shape of game state the browser ever receives. No answer keys. */
export function publicSession(session, player) {
  const subject = getSubject(session.subjectId);
  const character = getCharacter(session.characterId);
  const cs = session.current;
  const challenge = cs && getChallenge(cs.challengeId);
  const revealed = cs && cs.status !== 'active';

  return {
    id: session.id,
    status: session.status,
    endReason: session.endReason,
    subject,
    character: publicCharacter(character),
    lives: session.lives,
    maxLives: MAX_LIVES,
    difficulty: session.difficulty,
    tier: tierFor(session.difficulty),
    challengeNumber: session.challengeNumber,
    totalChallenges: session.totalChallenges,
    xpEarned: session.xpEarned,
    player: publicPlayer(player),
    challenge: cs && {
      id: challenge.id,
      status: cs.status,
      claim: challenge.claim,
      code: challenge.code || null,
      // Topic and objective hint at the answer, so they are revealed after the fight.
      topic: revealed ? challenge.topic : null,
      objective: revealed ? challenge.objective : null,
      hp: cs.hp,
      maxHp: challenge.maxHp,
      attemptsLeft: Math.max(0, maxFailedAttempts(character, session.difficulty) - cs.failedAttempts),
      maxAttempts: maxFailedAttempts(character, session.difficulty),
      hintsUsed: cs.hintsUsed,
      maxHints: challenge.hints.length,
      maxXp: maxAvailableXp(challenge, session.difficulty, cs.hintsUsed),
      nextHintMaxXp: maxAvailableXp(challenge, session.difficulty, cs.hintsUsed + 1),
      counterExpected: counterRequired(challenge, character, session.difficulty),
      landed: challenge.concepts
        .filter((c) => cs.concepts[c.id] !== 'absent')
        .map((c) => ({ label: c.label, status: cs.concepts[c.id] })),
      messages: cs.messages,
      result: cs.result,
    },
    summary: session.summary,
  };
}

export function publicPlayer(player) {
  return {
    id: player.id,
    ...levelInfo(player.xp),
    sessionsPlayed: player.sessionsPlayed,
    activeSessionId: player.activeSessionId,
    subjects: Object.fromEntries(
      Object.entries(player.subjects).map(([id, p]) => [
        id,
        { difficulty: p.difficulty, tier: tierFor(p.difficulty), completed: p.completed.length },
      ]),
    ),
  };
}
