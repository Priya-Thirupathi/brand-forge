// TRD.md §10 [D16]: per-IP hourly limit and a rolling-24h global cap, both counted from `runs`
// by the caller (via GenerationStore.countRuns, build step 6) — this is just the pure decision
// given those counts, so it's testable without a database.

export interface RateLimitCounts {
  ipRunsInLastHour: number;
  globalRunsInLast24h: number;
}

export interface RateLimitConfig {
  perIpLimitPerHour: number;
  globalDailyCap: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited"; retryAfterS: number }
  | { allowed: false; reason: "daily_cap_reached"; retryAfterS: number };

const HOUR_S = 3600;
const DAY_S = 86_400;

export function checkRateLimit(counts: RateLimitCounts, config: RateLimitConfig): RateLimitDecision {
  // Checked first: the global cap protects the shared free-tier quota, so it wins even for an
  // IP that's still under its own per-hour limit.
  if (counts.globalRunsInLast24h >= config.globalDailyCap) {
    // Same reasoning as rate_limited below: this is a rolling 24h window, not a calendar-day
    // reset, and countRuns returns a count, not each run's timestamp — so this can't know
    // exactly when the oldest counted run ages out. 24h from now is always a safe upper bound
    // (the window itself is 24h wide), not a precise one.
    return { allowed: false, reason: "daily_cap_reached", retryAfterS: DAY_S };
  }
  if (counts.ipRunsInLastHour >= config.perIpLimitPerHour) {
    // GenerationStore.countRuns returns a count, not each run's timestamp, so this can't know
    // exactly when the oldest run in the window ages out — an hour is a safe upper bound, not
    // a precise one.
    return { allowed: false, reason: "rate_limited", retryAfterS: HOUR_S };
  }
  return { allowed: true };
}
