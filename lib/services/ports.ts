// Ports the service layer orchestrates against (TRD.md §5 "Ports", clean-code structure
// D23). Adapters implement these — the Postgres adapter (build step 6) implements
// GenerationStore; the Gemini adapter (build step 4) implements LlmClient.

import type { StepName } from "@/lib/contracts/stepName";
import type { Violation } from "@/lib/contracts/violation";
import type { FeasibilityOptionFacts } from "@/lib/domain/types";

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
  // The failed run this one is retrying without redoing its already-succeeded steps — a new
  // run row, not a continuation of the old one (runs stay create-once/finish-once).
  resumedFromRunId?: string;
  // D30: the succeeded run this one branched off by picking a different name candidate. Kept
  // apart from resumedFromRunId on purpose — a resume retries a run that errored, a regenerate
  // forks one that worked, and collapsing them would make the Runs tab report every regenerate
  // as a failure retry.
  regeneratedFromRunId?: string;
  // Set only on `source: "eval"` runs, from the harness's `X-Eval-Run-Id` (TRD.md §8/§9) —
  // traceability from this run back to the eval_runs row that produced it.
  evalRunId?: string;
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

export interface RejectedFailure {
  step: StepName | "input";
  violations: Violation[];
}

export interface ErrorFailure {
  step: StepName;
  error: TransportFailureReason;
  message: string;
}

export type RunFailure = RejectedFailure | ErrorFailure;

export interface NameCandidateRecord {
  name: string;
  rationale: string;
  passed: boolean;
  violations: Violation[];
}

// What actually gets persisted to `brands`/`products` (TRD.md §4) on a succeeded run — the
// service layer has this from lib/domain/result.ts's SucceededGeneration; a rejected or
// errored run never reaches this shape, since content only reaches storage once accepted.
export interface SucceededRunContent {
  brandName: string;
  toneNotes: { voice: string[]; audience: string; personality: string; avoid: string[] };
  tagline: string;
  description: string;
  packaging: { headline: string; body: string; callouts: string[] };
  // The option's facts as they were at generation time (products.feasibility_snapshot) — a
  // snapshot, independent of whatever the feasibility_options row says later.
  feasibilitySnapshot: FeasibilityOptionFacts;
  // Stage 5, item 2 (D29): present only for a brand follow-up — the new product attaches to
  // this already-existing brand row instead of a fresh one being created.
  existingBrandId?: string;
}

interface FinishedRunBase {
  runId: string;
  // Only passing candidates' names reach the client (TRD.md §5 "Name selection"), but the
  // stored record keeps every candidate — rejected ones included — for `/api/runs` debugging.
  // Present whenever the naming step ran at all, regardless of how the run ultimately finished.
  nameCandidates?: NameCandidateRecord[];
  promptVersions: Partial<Record<StepName, string>>;
  usage: TokenUsage;
  qualityRetries: number;
  transportRetries: number;
  latencyMs: number;
  firstEventMs?: number;
  steps: RunStepRecord[];
}

// A discriminated union, not a loose `status` + optional `failure`/`content` bag: it's
// impossible to construct a "succeeded" record with no content, or a "rejected" one with the
// wrong failure shape — the compiler enforces what TRD.md §4's `runs` columns require per
// status, rather than leaving it to a runtime check.
export type FinishedRun =
  | (FinishedRunBase & { status: "succeeded"; content: SucceededRunContent })
  | (FinishedRunBase & { status: "rejected"; failure: RejectedFailure })
  | (FinishedRunBase & { status: "error"; failure: ErrorFailure });

// The ids a succeeded run's insert produced (TRD.md §8 GenerateResult.brand.id/product.id) —
// the route handler needs them to shape the API response, but a rejected/errored run creates
// neither row, so callers must check `status` before expecting this back.
export interface FinishedRunIds {
  brandId: string;
  productId: string;
}

export interface GenerationStore {
  findOption(category: string, optionId?: string): Promise<FeasibilityOption | null>;
  countRuns(filter: { ipHash?: string; since: Date }): Promise<number>;
  startRun(run: NewRun): Promise<string>;
  finishRun(record: FinishedRun): Promise<FinishedRunIds | undefined>; // one transaction
}
