import { NextResponse, type NextRequest } from "next/server";
import { GenerateRequestSchema, type GenerateErrorCode, type GenerateEvent, type GenerateResult } from "@/lib/contracts/generate";
import type { FeasibilityOptionFacts } from "@/lib/domain/types";
import type { GenerationOutcome } from "@/lib/domain/result";
import type { FeasibilityOption, FinishedRunIds, TransportFailureReason } from "@/lib/services/ports";
import { runGeneration, type RunMeta, type RunProgressEvent } from "@/lib/services/runGeneration";
import { checkRateLimit } from "@/lib/services/rateLimitPolicy";
import { pool } from "@/lib/adapters/postgres/pool";
import { createPostgresGenerationStore } from "@/lib/adapters/postgres/generationStore";
import { createGeminiClient } from "@/lib/adapters/gemini/client";
import { findCategory } from "@/lib/adapters/postgres/catalog";
import { hashIp } from "@/lib/adapters/postgres/ipHash";
import { getClientIp } from "@/lib/adapters/clientIp";
import { errorResponse, validationErrorResponse } from "../_shared/response";

// Next.js route segment config: must be a literal for the build's static analysis, not a
// value derived from RUN_DEADLINE_MS (lib/services/runGeneration.ts's 25s run deadline) —
// 5s of headroom on top of it for admission and the final DB write.
export const maxDuration = 30;

const store = createPostgresGenerationStore(pool);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export async function POST(request: NextRequest) {
  const salt = process.env.IP_HASH_SALT;
  if (!salt) {
    return errorResponse("internal", "Server is misconfigured (IP_HASH_SALT is not set).", 500);
  }

  const json = await request.json().catch(() => null);
  const parsed = GenerateRequestSchema.safeParse(json);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const { idea, category: categorySlug, feasibility_option_id: feasibilityOptionId } = parsed.data;

  const category = await findCategory(pool, categorySlug);
  if (!category) {
    return errorResponse("invalid_input", `Unknown category "${categorySlug}".`, 400);
  }
  const option = await store.findOption(categorySlug, feasibilityOptionId);
  if (!option) {
    return errorResponse(
      "invalid_input",
      feasibilityOptionId ? `Unknown feasibility_option_id for category "${categorySlug}".` : `Category "${categorySlug}" has no default feasibility option.`,
      400,
    );
  }

  // TRD.md §10: requests with no identifiable IP share one bucket, rather than each bypassing
  // the rate limit entirely.
  const ip = getClientIp(request.headers) ?? "unknown";
  const clientIpHash = hashIp(ip, salt);

  const rateLimitDecision = checkRateLimit(
    {
      ipRunsInLastHour: await store.countRuns({ ipHash: clientIpHash, since: new Date(Date.now() - HOUR_MS) }),
      globalRunsInLast24h: await store.countRuns({ since: new Date(Date.now() - DAY_MS) }),
    },
    {
      perIpLimitPerHour: Number(process.env.RATE_LIMIT_GENERATE_PER_HOUR ?? 10),
      globalDailyCap: Number(process.env.GLOBAL_DAILY_GENERATION_CAP ?? 50),
    },
  );
  if (!rateLimitDecision.allowed) {
    if (rateLimitDecision.reason === "rate_limited") {
      return errorResponse("rate_limited", "Too many generations from this address. Try again later.", 429, {
        retry_after_s: rateLimitDecision.retryAfterS,
      });
    }
    return errorResponse("daily_cap_reached", "The daily generation limit has been reached. Try again tomorrow.", 429);
  }

  const input = {
    idea,
    category,
    feasibilityOptionId: option.id,
    option: toFeasibilityOptionFacts(option),
    source: "user" as const,
    clientIpHash,
  };

  if (request.headers.get("accept") === "application/x-ndjson") {
    return streamGeneration(input, request.signal);
  }
  return respondOnce(input, request.signal);
}

// Built lazily inside each handler's try/catch below, not at module scope like `pool` — the
// pool needs to persist connections across requests, but re-wrapping the SDK per call is
// cheap, and building it here means a missing GEMINI_API_KEY surfaces as our own `internal`
// 500, not an unhandled crash the first time this route is hit.
function createLlmClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return createGeminiClient(apiKey);
}

function toFeasibilityOptionFacts(option: FeasibilityOption): FeasibilityOptionFacts {
  return {
    material: option.material,
    materialTerms: option.materialTerms,
    costLow: option.costLow,
    costHigh: option.costHigh,
    currency: option.currency,
    moq: option.moq,
    leadTimeDaysLow: option.leadTimeDaysLow,
    leadTimeDaysHigh: option.leadTimeDaysHigh,
    assumptions: option.assumptions,
  };
}

type GenerationInput = Parameters<typeof runGeneration>[0];

async function respondOnce(input: GenerationInput, signal: AbortSignal) {
  try {
    const result = await runGeneration(input, { llmClient: createLlmClient(), store }, { signal });
    if (result.outcome.status === "error") {
      return errorResponse(mapErrorCode(result.outcome.error), result.outcome.message, 500, { run_id: result.runId });
    }
    return NextResponse.json(buildGenerateResult(result.runId, result.outcome, result.meta, result.ids));
  } catch {
    return errorResponse("internal", "Something went wrong before the run could finish.", 500);
  }
}

function streamGeneration(input: GenerationInput, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerateEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const result = await runGeneration(
          input,
          { llmClient: createLlmClient(), store },
          { signal, onEvent: (event) => send(toGenerateEvent(event)) },
        );
        if (result.outcome.status === "error") {
          send({ type: "error", run_id: result.runId, code: mapErrorCode(result.outcome.error), message: result.outcome.message });
        } else {
          send({ type: "result", result: buildGenerateResult(result.runId, result.outcome, result.meta, result.ids) });
        }
      } catch {
        // No run_id was ever admitted (e.g. store.startRun itself failed) — TRD.md §8 requires
        // one on every error event, so this is the one case with nothing real to put there.
        send({ type: "error", run_id: "", code: "internal", message: "Something went wrong before the run could finish." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function toGenerateEvent(event: RunProgressEvent): GenerateEvent {
  if (event.type === "run_started") return { type: "run_started", run_id: event.runId };
  return event;
}

// TransportFailureReason (lib/services/ports.ts) → the stream's error vocabulary (TRD.md §8) —
// "timeout" becomes "deadline_exceeded" so the client never has to know an internal transport
// retry budget expired vs. genuinely missing the run's RUN_DEADLINE_MS budget.
function mapErrorCode(reason: TransportFailureReason): GenerateErrorCode {
  if (reason === "timeout") return "deadline_exceeded";
  return reason;
}

function buildGenerateResult(runId: string, outcome: GenerationOutcome, meta: RunMeta, ids: FinishedRunIds | undefined): GenerateResult {
  return {
    run_id: runId,
    status: outcome.status,
    feasibility: {
      material: outcome.feasibility.material,
      cost_low: outcome.feasibility.costLow,
      cost_high: outcome.feasibility.costHigh,
      currency: outcome.feasibility.currency,
      moq: outcome.feasibility.moq,
      lead_time_days_low: outcome.feasibility.leadTimeDaysLow,
      lead_time_days_high: outcome.feasibility.leadTimeDaysHigh,
      assumptions: outcome.feasibility.assumptions,
      first_run_cost_low: outcome.feasibility.firstRunCash.low,
      first_run_cost_high: outcome.feasibility.firstRunCash.high,
    },
    brand: outcome.status === "succeeded" && ids ? { id: ids.brandId, name: outcome.brandName, tone_notes: outcome.toneNotes } : undefined,
    product:
      outcome.status === "succeeded" && ids
        ? { id: ids.productId, tagline: outcome.tagline, description: outcome.description, packaging: outcome.packaging }
        : undefined,
    name_candidates: outcome.status === "succeeded" ? outcome.nameCandidates : undefined,
    guardrails: {
      quality_retries: outcome.qualityRetries,
      failure: outcome.status === "rejected" ? outcome.failure : undefined,
    },
    meta: {
      models: meta.models,
      prompt_versions: meta.promptVersions,
      latency_ms: meta.latencyMs,
      transport_retries: meta.transportRetries,
      tokens: { input: meta.usage.promptTokens, output: meta.usage.candidatesTokens, thinking: meta.usage.thoughtsTokens },
    },
  };
}
