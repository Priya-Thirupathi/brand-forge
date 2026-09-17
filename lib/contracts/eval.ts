import { z } from "zod";

// TRD.md §4/§9 (Stage 2). Shared by the CLI (lib/eval), the Postgres eval store, and
// GET /api/eval/summary — contracts may only import zod [D23].

export const EvalPromptVariantSchema = z.object({
  step: z.literal("naming"),
  variant: z.literal("degraded"),
});
export type EvalPromptVariant = z.infer<typeof EvalPromptVariantSchema>;

// `X-Eval-Prompt-Variant: step=variant`, e.g. `naming=degraded`. Only that one pair exists
// today (TRD.md §9 sensitivity proof) — parsing is deliberately narrow, not a generic
// `step=string` map, since an unrecognized variant must 400, not silently no-op.
export function parseEvalPromptVariant(header: string): EvalPromptVariant | null {
  const [step, variant] = header.split("=", 2);
  if (step === "naming" && variant === "degraded") return { step, variant };
  return null;
}

export const EvalExpectedOutcomeSchema = z.enum(["pass", "reject", "safe"]);
export type EvalExpectedOutcome = z.infer<typeof EvalExpectedOutcomeSchema>;

export const EvalActualOutcomeSchema = z.enum(["pass", "reject", "error", "admission_error"]);
export type EvalActualOutcome = z.infer<typeof EvalActualOutcomeSchema>;

// lib/eval/fixture.ts's shape — a versioned, hand-curated case (TRD.md §9 "Fixture").
export const EvalCaseSchema = z.object({
  id: z.string(),
  category: z.string(),
  idea: z.string(),
  expected_outcome: EvalExpectedOutcomeSchema,
  // Non-empty only for the 6 adversarial cases — documents *why* this case exists, shown in
  // `compare` output when a case's outcome doesn't match, never sent to the app.
  note: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const JudgeResultSchema = z.object({
  relevance: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  reason: z.string(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

// One eval_results row (TRD.md §4) — what the runner persists per case × repeat.
export const EvalResultRowSchema = z.object({
  eval_run_id: z.string(),
  case_id: z.string(),
  repeat: z.number().int().min(1),
  run_id: z.string().nullable(),
  expected_outcome: EvalExpectedOutcomeSchema,
  actual_outcome: EvalActualOutcomeSchema,
  outcome_match: z.boolean(),
  first_attempt_pass: z.boolean().nullable(),
  quality_retries: z.number().int().nullable(),
  throttled: z.boolean(),
  latency_ms: z.number().int().nullable(),
  first_event_ms: z.number().int().nullable(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  thinking_tokens: z.number().int(),
  relevance_score: z.number().min(0).max(1).nullable(),
  distinctiveness_score: z.number().min(0).max(1).nullable(),
  name_uniqueness: z.number().min(0).max(1).nullable(),
  judge_reason: z.string().nullable(),
});
export type EvalResultRow = z.infer<typeof EvalResultRowSchema>;

// D18: one metric's paired bootstrap comparison against the baseline.
export const MetricDeltaSchema = z.object({
  baseline_mean: z.number(),
  candidate_mean: z.number(),
  delta: z.number(),
  ci_low: z.number(),
  ci_high: z.number(),
  flagged: z.boolean(),
});
export type MetricDelta = z.infer<typeof MetricDeltaSchema>;

export const EvalAggregateSchema = z.object({
  cases: z.number().int(),
  repeats: z.number().int(),
  outcome_match_rate: z.number(),
  first_attempt_pass_rate: z.number(),
  mean_quality_retries: z.number(),
  throttled_rate: z.number(),
  mean_relevance: z.number().nullable(),
  mean_distinctiveness: z.number().nullable(),
  mean_name_uniqueness: z.number().nullable(),
  latency_ms_p50: z.number().nullable(),
  latency_ms_p95: z.number().nullable(),
  first_event_ms_p50: z.number().nullable(),
  mean_tokens: z.object({ input: z.number(), output: z.number(), thinking: z.number() }),
});
export type EvalAggregate = z.infer<typeof EvalAggregateSchema>;

export const EvalComparisonSchema = z.object({
  baseline_eval_run_id: z.string(),
  relevance: MetricDeltaSchema,
  distinctiveness: MetricDeltaSchema,
  outcome_match_rate: MetricDeltaSchema,
  latency_ms_p50: MetricDeltaSchema,
});
export type EvalComparison = z.infer<typeof EvalComparisonSchema>;

// GET /api/eval/summary response row (TRD.md §8) — never eval_results detail.
export const EvalRunSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  git_sha: z.string(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  is_baseline: z.boolean(),
  repeats: z.number().int(),
  aggregate: EvalAggregateSchema.nullable(),
  comparison: EvalComparisonSchema.nullable(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

export const EvalSummaryResponseSchema = z.object({
  runs: z.array(EvalRunSummarySchema),
});
export type EvalSummaryResponse = z.infer<typeof EvalSummaryResponseSchema>;
