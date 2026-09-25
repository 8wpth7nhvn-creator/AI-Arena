// Live AI backed by Claude through the official Anthropic SDK.
// Loaded only on the server, and only when an API key is configured.

import {
  EVALUATION_SYSTEM,
  EVALUATION_SCHEMA,
  evaluationPrompt,
  voiceSystem,
  voicePrompt,
  summarySystem,
  summaryPrompt,
} from './prompts.js';
import { MalformedAIOutput } from './validate.js';

export class AIUnavailableError extends Error {
  constructor(msg, cause) {
    super(msg);
    this.name = 'AIUnavailableError';
    this.cause = cause;
  }
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export async function createLiveAI({
  apiKey,
  model = 'claude-opus-5',
  evalEffort = 'medium',
  voiceEffort = 'low',
  useFallbacks = true,
  baseURL, // optional: proxies / tests
  maxRetries = 1,
} = {}) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries, ...(baseURL ? { baseURL } : {}) });
  let fallbacksEnabled = useFallbacks;

  async function send({ system, user, effort, maxTokens, schema }) {
    const params = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    };
    let response;
    try {
      response = fallbacksEnabled
        ? // Server-side fallbacks re-route a safety-classifier refusal to a fallback model instead of failing.
          await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && fallbacksEnabled) {
        // Not every account or model accepts the fallback beta; retry once without it.
        fallbacksEnabled = false;
        return send({ system, user, effort, maxTokens, schema });
      }
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AIUnavailableError('The AI service rejected the API key.', err);
      }
      if (err instanceof Anthropic.RateLimitError) throw new AIUnavailableError('The AI service is busy.', err);
      if (err instanceof Anthropic.APIConnectionError) throw new AIUnavailableError('Cannot reach the AI service.', err);
      if (err instanceof Anthropic.APIError) throw new AIUnavailableError(`AI service error (${err.status ?? 'unknown'}).`, err);
      throw err;
    }
    if (response.stop_reason === 'refusal') throw new MalformedAIOutput('model declined to answer');
    if (response.stop_reason === 'max_tokens') throw new MalformedAIOutput('response was truncated');
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new MalformedAIOutput('empty response');
    return text;
  }

  return {
    kind: 'live',
    model,
    evaluate(ctx) {
      return send({
        system: EVALUATION_SYSTEM,
        user: evaluationPrompt(ctx),
        effort: evalEffort,
        maxTokens: 8000,
        schema: EVALUATION_SCHEMA,
      });
    },
    speak(ctx) {
      return send({
        system: voiceSystem(ctx.character),
        user: voicePrompt(ctx),
        effort: voiceEffort,
        maxTokens: 2000,
      });
    },
    summarize({ character, stats }) {
      return send({
        system: summarySystem(character),
        user: summaryPrompt(stats),
        effort: voiceEffort,
        maxTokens: 2000,
      });
    },
  };
}
