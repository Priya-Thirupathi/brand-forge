// TRD.md §10 [D16]: a single rolling-24h global cap, counted from `runs` by the caller (via
// GenerationStore.countRuns, build step 6) — this is just the pure decision given that count,
// so it's testable without a database.
//
// There is deliberately no per-visitor limit. With no billing attached to either provider, the
// only thing worth defending is the shared free-tier quota, and the global cap does that
// directly. A per-IP throttle cost the app its only piece of personal data and didn't even
// prevent exhaustion — 10/hour over a day exceeded the daily cap anyway.

export interface RateLimitCounts {
  globalRunsInLast24h: number;
}

export interface RateLimitConfig {
  globalDailyCap: number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; reason: "daily_cap_reached"; retryAfterS: number };

const DAY_S = 86_400;

export function checkRateLimit(counts: RateLimitCounts, config: RateLimitConfig): RateLimitDecision {
  if (counts.globalRunsInLast24h >= config.globalDailyCap) {
    // A rolling 24h window, not a calendar-day reset, and countRuns returns a count rather than
    // each run's timestamp — so this can't know exactly when the oldest counted run ages out.
    // 24h from now is always a safe upper bound (the window itself is 24h wide), not a precise
    // one, which is why the UI phrases it as "in a while".
    return { allowed: false, reason: "daily_cap_reached", retryAfterS: DAY_S };
  }
  return { allowed: true };
}
