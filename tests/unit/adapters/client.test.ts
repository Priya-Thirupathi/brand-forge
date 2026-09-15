import { ApiError, BlockedReason, FinishReason, type GenerateContentResponse } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiClientWithFn, type GenerateContentFn } from "@/lib/adapters/gemini/client";
import type { LlmRequest } from "@/lib/services/ports";

function baseRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: "gemini-3.8-flash",
    system: "You are a branding expert.",
    user: "<idea>a reusable water bottle</idea>",
    responseJsonSchema: { type: "object" },
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  };
}

function fakeResponse(overrides: Partial<GenerateContentResponse>): GenerateContentResponse {
  return overrides as GenerateContentResponse;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createGeminiClientWithFn", () => {
  it("returns ok with the parsed json and token usage on success", async () => {
    const generateContent: GenerateContentFn = vi.fn(async () =>
      fakeResponse({
        text: JSON.stringify({ candidates: [{ name: "Ridge", rationale: "short, memorable" }] }),
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 35 },
      }),
    );
    const client = createGeminiClientWithFn(generateContent);

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({
      kind: "ok",
      json: { candidates: [{ name: "Ridge", rationale: "short, memorable" }] },
      usage: { promptTokens: 10, candidatesTokens: 20, thoughtsTokens: 5, totalTokens: 35 },
      transportRetries: 0,
    });
  });

  it("maps a prompt safety block to prompt_blocked", async () => {
    const generateContent: GenerateContentFn = vi.fn(async () =>
      fakeResponse({ promptFeedback: { blockReason: BlockedReason.SAFETY } }),
    );
    const client = createGeminiClientWithFn(generateContent);

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "prompt_blocked", transportRetries: 0 });
  });

  it("maps a response safety block to response_blocked", async () => {
    const generateContent: GenerateContentFn = vi.fn(async () =>
      fakeResponse({
        candidates: [{ finishReason: FinishReason.SAFETY }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 0, thoughtsTokenCount: 0, totalTokenCount: 4 },
      }),
    );
    const client = createGeminiClientWithFn(generateContent);

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "response_blocked", transportRetries: 0 });
  });

  it("maps unparsable response text to a failed invalid_json outcome", async () => {
    const generateContent: GenerateContentFn = vi.fn(async () => fakeResponse({ text: "not json" }));
    const client = createGeminiClientWithFn(generateContent);

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "invalid_json" });
  });

  it("maps a non-retryable ApiError status to a failed provider_error outcome", async () => {
    const generateContent: GenerateContentFn = vi.fn(async () => {
      throw new ApiError({ status: 400, message: "invalid argument" });
    });
    const client = createGeminiClientWithFn(generateContent);

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "provider_error", transportRetries: 0 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("maps a daily-quota ApiError to quota_exhausted without retrying", async () => {
    const message = JSON.stringify({
      error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "limit 'GenerateRequestsPerDayPerProject' exceeded" },
    });
    const generateContent: GenerateContentFn = vi.fn(async () => {
      throw new ApiError({ status: 429, message });
    });
    const client = createGeminiClientWithFn(generateContent);

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "quota_exhausted", transportRetries: 0 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("retries a transient ApiError and succeeds, counting the transport retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    let calls = 0;
    const generateContent: GenerateContentFn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new ApiError({ status: 503, message: "Service Unavailable" });
      return fakeResponse({ text: JSON.stringify({ ok: true }) });
    });
    const client = createGeminiClientWithFn(generateContent);

    const promise = client.generateJson(baseRequest());
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await promise;

    expect(outcome).toMatchObject({ kind: "ok", json: { ok: true }, transportRetries: 1 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("treats its own per-call timeout as a retryable timeout, not an abort", async () => {
    vi.useFakeTimers();

    const generateContent: GenerateContentFn = vi.fn(
      (params) =>
        new Promise<GenerateContentResponse>((_, reject) => {
          params.config?.abortSignal?.addEventListener("abort", () => {
            const error = new Error("aborted by signal");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const client = createGeminiClientWithFn(generateContent);

    // Deadline is close enough that after the first 10s per-call timeout, less than the 2s
    // minimum lead time remains — the retry is skipped and this surfaces as "timeout", not
    // silently retried into an unrelated outcome.
    const start = Date.now();
    const promise = client.generateJson(baseRequest({ deadlineAt: start + 10_000 + 1000 }));
    await vi.advanceTimersByTimeAsync(10_000);
    const outcome = await promise;

    expect(outcome).toMatchObject({ kind: "failed", error: "timeout", transportRetries: 0 });
  });

  it("maps an externally aborted request to a failed aborted outcome, not a retry", async () => {
    const controller = new AbortController();
    const generateContent: GenerateContentFn = vi.fn(
      (params) =>
        new Promise<GenerateContentResponse>((_, reject) => {
          params.config?.abortSignal?.addEventListener("abort", () => {
            const error = new Error("aborted by signal");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const client = createGeminiClientWithFn(generateContent);

    const promise = client.generateJson(baseRequest({ signal: controller.signal }));
    controller.abort();
    const outcome = await promise;

    expect(outcome).toMatchObject({ kind: "failed", error: "aborted", transportRetries: 0 });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
