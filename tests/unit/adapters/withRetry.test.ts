import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/adapters/gemini/withRetry";
import type { Clock } from "@/lib/services/ports";

function fixedClock(startAt: number): Clock {
  return { now: () => startAt };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRetry", () => {
  it("retries a retryable error until it succeeds, counting transport retries", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });
    const sleep = vi.fn(async () => {});

    const outcome = await withRetry(fn, {
      deadlineAt: Date.now() + 60_000,
      clock: fixedClock(Date.now()),
      sleep,
      classify: () => ({ retryable: true }),
    });

    expect(outcome).toEqual({ ok: true, value: "ok", transportRetries: 2 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable error", async () => {
    const error = new Error("bad request");
    const fn = vi.fn(async () => {
      throw error;
    });
    const sleep = vi.fn(async () => {});

    const outcome = await withRetry(fn, {
      deadlineAt: Date.now() + 60_000,
      sleep,
      classify: () => ({ retryable: false }),
    });

    expect(outcome).toEqual({ ok: false, error, transportRetries: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never starts a retry that can't complete before the deadline", async () => {
    const error = new Error("transient");
    const fn = vi.fn(async () => {
      throw error;
    });
    const sleep = vi.fn(async () => {});
    const now = 1_000_000;

    // Less than the 2s minimum lead time left before the deadline — no retry should fire,
    // no matter how small the computed backoff is.
    const outcome = await withRetry(fn, {
      deadlineAt: now + 1000,
      clock: fixedClock(now),
      sleep,
      classify: () => ({ retryable: true }),
    });

    expect(outcome).toEqual({ ok: false, error, transportRetries: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("honors a server-suggested retry delay larger than the computed backoff", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // jittered backoff floors at 0
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error("transient");
      return "ok";
    });
    const sleep = vi.fn(async () => {});

    await withRetry(fn, {
      deadlineAt: Date.now() + 60_000,
      sleep,
      classify: () => ({ retryable: true, retryDelayMs: 5000 }),
    });

    expect(sleep).toHaveBeenCalledWith(5000);
  });
});
