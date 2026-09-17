import { describe, expect, it } from "vitest";
import { classifyGroqError, GroqApiError } from "@/lib/adapters/qwen/errors";

describe("classifyGroqError", () => {
  it.each([408, 429, 500, 502, 503, 504])("marks status %d retryable", (status) => {
    const error = new GroqApiError({ status, message: "transient" });
    expect(classifyGroqError(error)).toMatchObject({ status, retryable: true, isDailyQuota: false });
  });

  it("marks a non-retryable status like 400 as not retryable", () => {
    const error = new GroqApiError({ status: 400, message: "bad request" });
    expect(classifyGroqError(error)).toMatchObject({ status: 400, retryable: false, isDailyQuota: false });
  });

  it("treats a 429 naming a per-day limit as not retryable within this run", () => {
    const message = "Rate limit reached for model qwen/qwen3.8-27b on requests per day (RPD): Limit 1000, Used 1000";
    const error = new GroqApiError({ status: 429, message });
    expect(classifyGroqError(error)).toMatchObject({ status: 429, retryable: false, isDailyQuota: true });
  });

  it("keeps a 429 naming a per-minute limit retryable", () => {
    const message = "Rate limit reached for model qwen/qwen3.8-27b on requests per minute (RPM): Limit 30, Used 30";
    const error = new GroqApiError({ status: 429, message });
    expect(classifyGroqError(error)).toMatchObject({ status: 429, retryable: true, isDailyQuota: false });
  });

  it("passes through the retry-after header value in milliseconds", () => {
    const error = new GroqApiError({ status: 429, message: "rate limited", retryAfterMs: 4200 });
    expect(classifyGroqError(error).retryDelayMs).toBe(4200);
  });

  it("returns no retry delay when none was given", () => {
    const error = new GroqApiError({ status: 503, message: "Service Unavailable" });
    expect(classifyGroqError(error).retryDelayMs).toBeUndefined();
  });

  it("treats a non-GroqApiError as not retryable", () => {
    expect(classifyGroqError(new Error("network down"))).toEqual({ retryable: false, isDailyQuota: false });
  });
});
