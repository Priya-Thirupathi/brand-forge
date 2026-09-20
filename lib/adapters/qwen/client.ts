// Alternate provider — Groq's OpenAI-compatible chat completions API, selectable in any
// environment via LLM_PROVIDER=qwen (see lib/adapters/createLlmClient.ts, D26). Originally
// added to test against Qwen without spending Gemini's free-tier quota; now also usable as the
// production provider for the same reason.
//
// Known gap vs. the Gemini adapter: Groq/Qwen exposes no equivalent of Gemini's safety
// feedback (D22), so this client never produces "prompt_blocked"/"response_blocked" outcomes —
// moderation guardrails simply don't get exercised while this provider is active — including in
// production, now that it's not gated to local dev (D2).
import type { LlmClient, LlmOutcome, LlmRequest, TokenUsage } from "@/lib/services/ports";
import { withRetry, type RetryClassification } from "../withRetry";
import { classifyGroqError, GroqApiError } from "./errors";

// Matches lib/adapters/gemini/client.ts's per-call timeout (TRD.md §5); Groq's hosted
// inference is fast enough (~450 tokens/s for qwen/qwen3.8-27b) that there's no reason to
// diverge from it.
const PER_CALL_TIMEOUT_MS = 10_000;

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// The one seam client logic needs from the platform — kept as bare `fetch` (no SDK exists for
// this dev-only path) so tests can supply a fake without a real network call.
export type FetchFn = typeof fetch;

class TransportTimeoutError extends Error {
  constructor() {
    super(`Groq call exceeded the ${PER_CALL_TIMEOUT_MS}ms per-call timeout`);
    this.name = "TransportTimeoutError";
  }
}

class ClientAbortedError extends Error {
  constructor() {
    super("Cancelled: the caller's signal aborted");
    this.name = "ClientAbortedError";
  }
}

export function createQwenClient(apiKey: string): LlmClient {
  return createQwenClientWithFn(fetch, apiKey);
}

export function createQwenClientWithFn(fetchFn: FetchFn, apiKey: string): LlmClient {
  return {
    async generateJson(request: LlmRequest): Promise<LlmOutcome> {
      const startedAt = Date.now();
      const latencyMs = () => Date.now() - startedAt;

      const outcome = await withRetry(() => callOnce(fetchFn, apiKey, request), {
        deadlineAt: request.deadlineAt,
        classify: classifyForRetry,
      });

      if (!outcome.ok) {
        return toFailureOutcome(outcome.error, outcome.transportRetries, latencyMs());
      }

      return toSuccessOutcome(outcome.value, outcome.transportRetries, latencyMs());
    },
  };
}

async function callOnce(fetchFn: FetchFn, apiKey: string, request: LlmRequest): Promise<ChatCompletionResponse> {
  // Same up-front check as the Gemini adapter: a signal aborted before this call started never
  // fires a freshly-attached listener, so a client disconnect during an earlier step must still
  // be honored here.
  if (request.signal?.aborted) {
    throw new ClientAbortedError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onExternalAbort);

  try {
    const response = await fetchFn(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "output", strict: true, schema: request.responseJsonSchema },
        },
        // We only need the final answer, not Qwen's thinking trace.
        reasoning_format: "hidden",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number.parseFloat(retryAfterHeader) * 1000 : undefined;
      throw new GroqApiError({ status: response.status, message: bodyText, retryAfterMs });
    }

    return (await response.json()) as ChatCompletionResponse;
  } catch (error) {
    if (error instanceof GroqApiError) throw error;
    if (controller.signal.aborted) {
      throw request.signal?.aborted ? new ClientAbortedError() : new TransportTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onExternalAbort);
  }
}

function classifyForRetry(error: unknown): RetryClassification {
  if (error instanceof ClientAbortedError) return { retryable: false };
  if (error instanceof TransportTimeoutError) return { retryable: true };

  const classified = classifyGroqError(error);
  return { retryable: classified.retryable, retryDelayMs: classified.retryDelayMs };
}

function toFailureOutcome(error: unknown, transportRetries: number, latencyMs: number): LlmOutcome {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof ClientAbortedError) {
    return { kind: "failed", error: "aborted", message, transportRetries, latencyMs };
  }
  if (error instanceof TransportTimeoutError) {
    return { kind: "failed", error: "timeout", message, transportRetries, latencyMs };
  }

  const classified = classifyGroqError(error);
  const reason = classified.isDailyQuota ? "quota_exhausted" : "provider_error";
  return { kind: "failed", error: reason, message, transportRetries, latencyMs };
}

function toSuccessOutcome(response: ChatCompletionResponse, transportRetries: number, latencyMs: number): LlmOutcome {
  const usage = toTokenUsage(response);
  const content = response.choices[0]?.message.content;

  if (content == null) {
    return { kind: "failed", error: "invalid_json", message: "Response had no content", transportRetries, latencyMs };
  }

  try {
    const json: unknown = JSON.parse(content);
    return { kind: "ok", json, usage, transportRetries, latencyMs };
  } catch {
    return { kind: "failed", error: "invalid_json", message: "Response content was not valid JSON", transportRetries, latencyMs };
  }
}

function toTokenUsage(response: ChatCompletionResponse): TokenUsage {
  const usage = response.usage;
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    candidatesTokens: usage?.completion_tokens ?? 0,
    // Groq's usage object doesn't break out reasoning tokens separately, and
    // reasoning_format: "hidden" means none were surfaced as visible output either way.
    thoughtsTokens: 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}
