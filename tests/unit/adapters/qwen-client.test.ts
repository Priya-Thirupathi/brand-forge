import { afterEach, describe, expect, it, vi } from "vitest";
import { createQwenClientWithFn, type FetchFn } from "@/lib/adapters/qwen/client";
import type { LlmRequest } from "@/lib/services/ports";

function baseRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: "qwen/qwen3.8-27b",
    system: "You are a branding expert.",
    user: "<idea>a reusable water bottle</idea>",
    responseJsonSchema: { type: "object" },
    deadlineAt: Date.now() + 60_000,
    ...overrides,
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, { status, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createQwenClientWithFn", () => {
  it("returns ok with the parsed json and token usage on success", async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      okResponse({
        choices: [{ message: { content: JSON.stringify({ candidates: [{ name: "Ridge" }] }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    );
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({
      kind: "ok",
      json: { candidates: [{ name: "Ridge" }] },
      usage: { promptTokens: 10, candidatesTokens: 20, thoughtsTokens: 0, totalTokens: 30 },
      transportRetries: 0,
    });
  });

  it("maps a missing content field to a failed invalid_json outcome", async () => {
    const fetchFn: FetchFn = vi.fn(async () => okResponse({ choices: [{ message: { content: null } }] }));
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "invalid_json" });
  });

  it("maps unparsable content to a failed invalid_json outcome", async () => {
    const fetchFn: FetchFn = vi.fn(async () => okResponse({ choices: [{ message: { content: "not json" } }] }));
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "invalid_json" });
  });

  it("maps a non-retryable status to a failed provider_error outcome", async () => {
    const fetchFn: FetchFn = vi.fn(async () => errorResponse(400, "bad request"));
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "provider_error", transportRetries: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps a daily-quota 429 to quota_exhausted without retrying", async () => {
    const fetchFn: FetchFn = vi.fn(async () =>
      errorResponse(429, "Rate limit reached for model qwen/qwen3.8-27b on requests per day (RPD)"),
    );
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const outcome = await client.generateJson(baseRequest());

    expect(outcome).toMatchObject({ kind: "failed", error: "quota_exhausted", transportRetries: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient error and succeeds, counting the transport retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    let calls = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return errorResponse(503, "Service Unavailable");
      return okResponse({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] });
    });
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const promise = client.generateJson(baseRequest());
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await promise;

    expect(outcome).toMatchObject({ kind: "ok", json: { ok: true }, transportRetries: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("honors a retry-after header over the computed backoff", async () => {
    vi.useFakeTimers();

    let calls = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return errorResponse(429, "Rate limit reached on requests per minute (RPM)", { "retry-after": "5" });
      return okResponse({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] });
    });
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const promise = client.generateJson(baseRequest());
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    const outcome = await promise;

    expect(outcome).toMatchObject({ kind: "ok", transportRetries: 1 });
  });

  it("treats its own per-call timeout as a retryable timeout, not an abort", async () => {
    vi.useFakeTimers();

    const fetchFn: FetchFn = vi.fn(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          const signal = (init as RequestInit).signal;
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted by signal");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const client = createQwenClientWithFn(fetchFn, "test-key");

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
    const fetchFn: FetchFn = vi.fn(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          const signal = (init as RequestInit).signal;
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted by signal");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const promise = client.generateJson(baseRequest({ signal: controller.signal }));
    controller.abort();
    const outcome = await promise;

    expect(outcome).toMatchObject({ kind: "failed", error: "aborted", transportRetries: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps a request whose signal was already aborted before the call to a failed aborted outcome", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn: FetchFn = vi.fn();
    const client = createQwenClientWithFn(fetchFn, "test-key");

    const outcome = await client.generateJson(baseRequest({ signal: controller.signal }));

    expect(outcome).toMatchObject({ kind: "failed", error: "aborted", transportRetries: 0 });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
