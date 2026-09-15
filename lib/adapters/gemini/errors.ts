import { ApiError } from "@google/genai";

// TRD.md §5 "Timeouts and retries" [D21].
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface ApiErrorClassification {
  status?: number;
  retryable: boolean;
  retryDelayMs?: number;
  isDailyQuota: boolean;
}

// Not every ApiError has a status this SDK version recognizes (e.g. a network error surfaced
// as a plain Error) — those fall through as non-retryable rather than guessed at.
export function classifyApiError(error: unknown): ApiErrorClassification {
  if (!(error instanceof ApiError)) {
    return { retryable: false, isDailyQuota: false };
  }

  const status = error.status;
  const isDailyQuota = status === 429 && isDailyQuotaMessage(error.message);
  return {
    status,
    retryable: !isDailyQuota && RETRYABLE_STATUSES.has(status),
    retryDelayMs: parseRetryDelayMs(error.message),
    isDailyQuota,
  };
}

// The SDK's ApiError.message is the raw JSON error body re-stringified. A RetryInfo detail
// carries the server's suggested wait as a duration string like "31s".
function parseRetryDelayMs(message: string): number | undefined {
  try {
    const body = JSON.parse(message) as {
      error?: { details?: Array<{ ["@type"]?: string; retryDelay?: string }> };
    };
    const retryInfo = body.error?.details?.find((detail) => detail["@type"]?.endsWith("RetryInfo"));
    const raw = retryInfo?.retryDelay;
    if (!raw) return undefined;
    const seconds = Number.parseFloat(raw.replace(/s$/, ""));
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
  } catch {
    return undefined;
  }
}

// Google names the free-tier per-minute and per-day quota ids differently (e.g.
// "...PerMinutePerProject..." vs "...PerDayPerProject..."); only the latter won't clear
// before this run's deadline, so only it should skip the transport retry entirely. This is a
// message-pattern heuristic, not a documented field — cheaper than a call to inspect quota
// metadata separately, but may need adjusting if Google changes the id format.
function isDailyQuotaMessage(message: string): boolean {
  return /PerDay/i.test(message);
}
