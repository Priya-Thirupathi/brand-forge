import type { Clock } from "@/lib/services/ports";

// TRD.md §5 "Timeouts and retries" [D21].
const BASE_DELAY_MS = 500;
const MAX_BACKOFF_MS = 8000;
// No retry that can't *start* at least this long before the deadline.
const MIN_LEAD_MS = 2000;

export interface RetryClassification {
  retryable: boolean;
  // Server-suggested delay (e.g. from a RetryInfo detail); honored when larger than the
  // computed backoff.
  retryDelayMs?: number;
}

export interface WithRetryOptions {
  // Epoch ms the run must finish by.
  deadlineAt: number;
  classify: (error: unknown) => RetryClassification;
  clock?: Clock;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number }) => void;
}

export type WithRetryOutcome<T> =
  | { ok: true; value: T; transportRetries: number }
  | { ok: false; error: unknown; transportRetries: number };

const systemClock: Clock = { now: () => Date.now() };
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: WithRetryOptions): Promise<WithRetryOutcome<T>> {
  const clock = options.clock ?? systemClock;
  const sleep = options.sleep ?? realSleep;
  let transportRetries = 0;

  for (let attempt = 1; ; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, transportRetries };
    } catch (error) {
      const classification = options.classify(error);
      if (!classification.retryable) {
        return { ok: false, error, transportRetries };
      }

      // Full jitter (AWS backoff strategy): a random delay in [0, cappedBackoff], not
      // cappedBackoff plus jitter — that's what keeps concurrent retries from clustering.
      const cappedBackoffMs = Math.min(MAX_BACKOFF_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
      const jitteredMs = Math.random() * cappedBackoffMs;
      const delayMs = Math.max(jitteredMs, classification.retryDelayMs ?? 0);

      if (clock.now() + delayMs + MIN_LEAD_MS > options.deadlineAt) {
        return { ok: false, error, transportRetries };
      }

      transportRetries++;
      options.onRetry?.({ attempt, delayMs });
      await sleep(delayMs);
    }
  }
}
