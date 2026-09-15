import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/services/rateLimitPolicy";

const config = { perIpLimitPerHour: 10, globalDailyCap: 50 };

describe("checkRateLimit", () => {
  it("allows a request under both limits", () => {
    expect(checkRateLimit({ ipRunsInLastHour: 0, globalRunsInLast24h: 0 }, config)).toEqual({ allowed: true });
  });

  it("rate-limits once the per-IP hourly count reaches the limit", () => {
    const decision = checkRateLimit({ ipRunsInLastHour: 10, globalRunsInLast24h: 0 }, config);
    expect(decision).toEqual({ allowed: false, reason: "rate_limited", retryAfterS: 3600 });
  });

  it("reaches the daily cap once the global count reaches the cap", () => {
    const decision = checkRateLimit({ ipRunsInLastHour: 0, globalRunsInLast24h: 50 }, config);
    expect(decision).toEqual({ allowed: false, reason: "daily_cap_reached" });
  });

  it("prefers the daily cap reason when both limits are exceeded", () => {
    const decision = checkRateLimit({ ipRunsInLastHour: 10, globalRunsInLast24h: 50 }, config);
    expect(decision).toEqual({ allowed: false, reason: "daily_cap_reached" });
  });
});
