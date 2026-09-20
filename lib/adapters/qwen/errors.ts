// Alternate LlmClient provider, selectable in any environment via LLM_PROVIDER=qwen (see
// lib/adapters/createLlmClient.ts, D26). Mirrors lib/adapters/gemini/errors.ts's shape so the
// two adapters stay easy to read side by side.

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class GroqApiError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(params: { status: number; message: string; retryAfterMs?: number }) {
    super(params.message);
    this.name = "GroqApiError";
    this.status = params.status;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export interface ApiErrorClassification {
  status?: number;
  retryable: boolean;
  retryDelayMs?: number;
  isDailyQuota: boolean;
}

// Not every thrown error is a GroqApiError (e.g. a network error surfaced as a plain Error) —
// those fall through as non-retryable rather than guessed at.
export function classifyGroqError(error: unknown): ApiErrorClassification {
  if (!(error instanceof GroqApiError)) {
    return { retryable: false, isDailyQuota: false };
  }

  const isDailyQuota = error.status === 429 && isDailyQuotaMessage(error.message);
  return {
    status: error.status,
    retryable: !isDailyQuota && RETRYABLE_STATUSES.has(error.status),
    retryDelayMs: error.retryAfterMs,
    isDailyQuota,
  };
}

// Groq's rate-limit message text names which limit was hit (e.g. "...on requests per day
// (RPD)..." vs "...on requests per minute (RPM)..."), with no separate structured quota-id
// field — same message-pattern-heuristic tradeoff as Gemini's isDailyQuotaMessage. Only a
// per-day/per-token-day limit won't clear before this run's deadline.
function isDailyQuotaMessage(message: string): boolean {
  return /\bper day\b|\(RPD\)|\(TPD\)/i.test(message);
}
