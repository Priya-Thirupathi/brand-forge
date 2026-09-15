import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { classifyApiError } from "@/lib/adapters/gemini/errors";

describe("classifyApiError", () => {
  it.each([408, 429, 500, 502, 503, 504])("marks status %d retryable", (status) => {
    const error = new ApiError({ status, message: "transient" });
    expect(classifyApiError(error)).toMatchObject({ status, retryable: true, isDailyQuota: false });
  });

  it("marks a non-retryable status like 400 as not retryable", () => {
    const error = new ApiError({ status: 400, message: "bad request" });
    expect(classifyApiError(error)).toMatchObject({ status: 400, retryable: false, isDailyQuota: false });
  });

  it("treats a 429 naming a per-day quota as not retryable within this run", () => {
    const message = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'Generate requests' and limit 'GenerateRequestsPerDayPerProject'",
      },
    });
    const error = new ApiError({ status: 429, message });
    expect(classifyApiError(error)).toMatchObject({ status: 429, retryable: false, isDailyQuota: true });
  });

  it("keeps a 429 without a per-day quota mention retryable", () => {
    const message = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'Generate requests' and limit 'GenerateRequestsPerMinutePerProject'",
      },
    });
    const error = new ApiError({ status: 429, message });
    expect(classifyApiError(error)).toMatchObject({ status: 429, retryable: true, isDailyQuota: false });
  });

  it("parses a RetryInfo detail's retryDelay into milliseconds", () => {
    const message = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "31s" }],
      },
    });
    const error = new ApiError({ status: 429, message });
    expect(classifyApiError(error).retryDelayMs).toBe(31_000);
  });

  it("returns no retry delay when the message isn't JSON", () => {
    const error = new ApiError({ status: 503, message: "Service Unavailable" });
    expect(classifyApiError(error).retryDelayMs).toBeUndefined();
  });

  it("treats a non-ApiError as not retryable", () => {
    expect(classifyApiError(new Error("network down"))).toEqual({ retryable: false, isDailyQuota: false });
  });
});
