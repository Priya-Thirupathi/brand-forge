import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import type { LlmClient, LlmOutcome, LlmRequest, TokenUsage } from "@/lib/services/ports";
import { withRetry, type RetryClassification } from "./withRetry";
import { classifyApiError } from "./errors";

// TRD.md §5 "Timeouts and retries".
const PER_CALL_TIMEOUT_MS = 10_000;

// The one seam client logic needs from the SDK — kept this narrow so tests can supply a fake
// without mocking the whole `GoogleGenAI` class.
export type GenerateContentFn = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

class TransportTimeoutError extends Error {
  constructor() {
    super(`Gemini call exceeded the ${PER_CALL_TIMEOUT_MS}ms per-call timeout`);
    this.name = "TransportTimeoutError";
  }
}

class ClientAbortedError extends Error {
  constructor() {
    super("Cancelled: the caller's signal aborted");
    this.name = "ClientAbortedError";
  }
}

export function createGeminiClient(apiKey: string): LlmClient {
  const ai = new GoogleGenAI({ apiKey });
  return createGeminiClientWithFn(ai.models.generateContent);
}

export function createGeminiClientWithFn(generateContent: GenerateContentFn): LlmClient {
  return {
    async generateJson(request: LlmRequest): Promise<LlmOutcome> {
      const startedAt = Date.now();
      const latencyMs = () => Date.now() - startedAt;

      const outcome = await withRetry(() => callOnce(generateContent, request), {
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

async function callOnce(generateContent: GenerateContentFn, request: LlmRequest): Promise<GenerateContentResponse> {
  // A signal aborted before this call started never fires a freshly-attached listener (the
  // DOM only notifies listeners of abort()s that happen *after* they're attached) — across a
  // multi-step run, a client disconnect during step 1 must still be honored by step 2's call.
  if (request.signal?.aborted) {
    throw new ClientAbortedError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onExternalAbort);

  try {
    return await generateContent({
      model: request.model,
      contents: request.user,
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseJsonSchema: request.responseJsonSchema,
        abortSignal: controller.signal,
        // SDK retry is disabled in favor of our own deadline-aware withRetry [D21].
        httpOptions: { timeout: PER_CALL_TIMEOUT_MS, retryOptions: { attempts: 1 } },
      },
    });
  } catch (error) {
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

  const classified = classifyApiError(error);
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

  const classified = classifyApiError(error);
  const reason = classified.isDailyQuota ? "quota_exhausted" : "provider_error";
  return { kind: "failed", error: reason, message, transportRetries, latencyMs };
}

function toSuccessOutcome(response: GenerateContentResponse, transportRetries: number, latencyMs: number): LlmOutcome {
  // Sent only in the first stream chunk / when no candidates were generated at all (D22).
  if (response.promptFeedback?.blockReason) {
    return { kind: "prompt_blocked", transportRetries, latencyMs };
  }

  const usage = toTokenUsage(response);
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason === "SAFETY") {
    return { kind: "response_blocked", usage, transportRetries, latencyMs };
  }

  const text = response.text;
  if (text === undefined) {
    return { kind: "failed", error: "invalid_json", message: "Response had no text content", transportRetries, latencyMs };
  }

  try {
    const json: unknown = JSON.parse(text);
    return { kind: "ok", json, usage, transportRetries, latencyMs };
  } catch {
    return { kind: "failed", error: "invalid_json", message: "Response text was not valid JSON", transportRetries, latencyMs };
  }
}

function toTokenUsage(response: GenerateContentResponse): TokenUsage {
  const usage = response.usageMetadata;
  return {
    promptTokens: usage?.promptTokenCount ?? 0,
    candidatesTokens: usage?.candidatesTokenCount ?? 0,
    thoughtsTokens: usage?.thoughtsTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
  };
}
