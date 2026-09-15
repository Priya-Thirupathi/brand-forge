// Ports the service layer orchestrates against (TRD.md §5 "Ports", clean-code structure
// D23). Adapters implement these — the Postgres adapter (build step 6) implements
// GenerationStore; the Gemini adapter (build step 4) implements LlmClient.

import type { StepName } from "@/lib/contracts/stepName";
import type { Violation } from "@/lib/contracts/violation";

export interface Clock {
  now(): number;
}

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  // From `z.toJSONSchema(agentSpec.outputSchema)` — the adapter treats it as opaque.
  responseJsonSchema: unknown;
  // Epoch ms the run must finish by; the adapter's transport retry never starts a retry that
  // can't complete before this (TRD.md §5 "Timeouts and retries").
  deadlineAt: number;
  // Client disconnect cancels in-flight calls (TRD.md §5).
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

// LlmClient never throws for provider failures (TRD.md §5) — every outcome, including
// safety blocks and exhausted retries, is a value the service layer pattern-matches on.
export type LlmOutcome =
  | { kind: "ok"; json: unknown; usage: TokenUsage; transportRetries: number; latencyMs: number }
  | { kind: "prompt_blocked"; transportRetries: number; latencyMs: number }
  | { kind: "response_blocked"; usage: TokenUsage; transportRetries: number; latencyMs: number }
  | {
      kind: "failed";
      error: "timeout" | "provider_error" | "quota_exhausted" | "invalid_json" | "aborted";
      message: string;
      transportRetries: number;
      latencyMs: number;
    };

export interface LlmClient {
  generateJson(request: LlmRequest): Promise<LlmOutcome>;
}

// The subset of LlmOutcome's failure reasons that are infrastructure failures, not content
// failures (TRD.md §4 run_steps.error) — these end the whole run as `error`, with no quality
// retry. "invalid_json" is deliberately excluded: an unparsable response is a content problem
// like a schema mismatch, so it goes through the quality-retry path as an `output.schema`
// violation instead.
export type TransportFailureReason = "timeout" | "provider_error" | "quota_exhausted" | "aborted";

// The full feasibility_options row (TRD.md §4) — a superset of the domain's
// FeasibilityOptionFacts (the trimmed, prompt-safe projection of the same data).
export interface FeasibilityOption {
  id: string;
  category: string;
  material: string;
  materialTerms: string[];
  costLow: number;
  costHigh: number;
  currency: string;
  moq: number;
  leadTimeDaysLow: number;
  leadTimeDaysHigh: number;
  assumptions: string;
}

export interface NewRun {
  source: "user" | "eval";
  idea: string;
  category: string;
  feasibilityOptionId: string;
  clientIpHash: string;
}

export interface RunStepRecord {
  step: StepName;
  attempt: 1 | 2;
  model: string;
  promptVersion: string;
  usage: TokenUsage;
  transportRetries: number;
  latencyMs: number;
  // Never exposed via the API (TRD.md §4) — kept only for debugging a rejected/errored run.
  rawOutput?: unknown;
  violations: Violation[];
  error?: TransportFailureReason;
}

export type RunFailure =
  | { step: StepName | "input"; violations: Violation[] }
  | { step: StepName; error: TransportFailureReason; message: string };

export interface FinishedRun {
  runId: string;
  status: "succeeded" | "rejected" | "error";
  failure?: RunFailure;
  // Only passing candidates' names reach the client (TRD.md §5 "Name selection"), but the
  // stored record keeps every candidate — rejected ones included — for `/api/runs` debugging.
  nameCandidates?: Array<{ name: string; rationale: string; passed: boolean; violations: Violation[] }>;
  promptVersions: Partial<Record<StepName, string>>;
  usage: TokenUsage;
  qualityRetries: number;
  transportRetries: number;
  latencyMs: number;
  firstEventMs?: number;
  steps: RunStepRecord[];
}

export interface GenerationStore {
  findOption(category: string, optionId?: string): Promise<FeasibilityOption | null>;
  countRuns(filter: { ipHash?: string; since: Date }): Promise<number>;
  startRun(run: NewRun): Promise<string>;
  finishRun(record: FinishedRun): Promise<void>; // one transaction
}
