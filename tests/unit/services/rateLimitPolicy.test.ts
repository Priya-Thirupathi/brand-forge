import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/services/rateLimitPolicy";

const config = { globalDailyCap: 50 };

describe("checkRateLimit", () => {
  it("allows a request under the cap", () => {
    expect(checkRateLimit({ globalRunsInLast24h: 0 }, config)).toEqual({ allowed: true });
  });

  it("allows the request that sits one under the cap", () => {
    expect(checkRateLimit({ globalRunsInLast24h: 49 }, config)).toEqual({ allowed: true });
  });

  it("reaches the daily cap once the global count reaches the cap", () => {
    const decision = checkRateLimit({ globalRunsInLast24h: 50 }, config);
    expect(decision).toEqual({ allowed: false, reason: "daily_cap_reached", retryAfterS: 86_400 });
  });

  it("stays capped once the count has overshot", () => {
    const decision = checkRateLimit({ globalRunsInLast24h: 51 }, config);
    expect(decision).toEqual({ allowed: false, reason: "daily_cap_reached", retryAfterS: 86_400 });
  });
});
