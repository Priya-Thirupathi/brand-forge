import { z } from "zod";
import { StepNameSchema, type StepName } from "./stepName";

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

// D32: the tier a step runs on. Defined here rather than in config/routing.ts because this is
// the only place it's parsed from untrusted input (an eval header); config/routing.ts imports
// the type back so there is one source of truth and no pair of enums to drift apart.
export const ModelTierSchema = z.enum(["strong", "cheap"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

// `X-Eval-Model-Tier: naming=cheap,packaging=cheap` — D12's Stage 5 experiment, moving one or
// more steps down a tier for a single eval run. Parsed as narrowly as parseEvalPromptVariant:
// an unrecognised step or tier must 400, never silently route to a default and record a
// comparison of something other than what was asked for.
export function parseEvalModelTiers(header: string): Partial<Record<StepName, ModelTier>> | null {
  const tiers: Partial<Record<StepName, ModelTier>> = {};
  for (const pair of header.split(",")) {
    const [step, tier] = pair.trim().split("=", 2);
    const parsedStep = StepNameSchema.safeParse(step);
    const parsedTier = ModelTierSchema.safeParse(tier);
    if (!parsedStep.success || !parsedTier.success) return null;
    tiers[parsedStep.data] = parsedTier.data;
  }
  return Object.keys(tiers).length > 0 ? tiers : null;
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
  // D31: the id of an *earlier* case in this same fixture whose brand this case attaches to,
  // making it a D29 brand follow-up (`follow_up_brand_id`) rather than a fresh generation.
  // Deliberately an optional field rather than a discriminated union on `kind`: every existing
  // case's literal stays byte-identical, so FIXTURE_VERSION reflects the cases that were
  // actually added and old baselines still pair on the case ids they share (lib/eval/
  // aggregate.ts's pairedValues drops unmatched ids rather than mispairing them).
  follow_up_to: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const JudgeResultSchema = z.object({
  relevance: z.number().min(0).max(1),
  distinctiveness: z.number().min(0).max(1),
  reason: z.string(),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

// D31: a separate judge call, not another field on JudgeResult. It answers a different question
// about different inputs (the copy against the brand's fixed tone_notes, with no reference to
// the idea's novelty), and only follow-up cases have anything to ask it — folding it into the
// main rubric would mean every ordinary case carried a dimension it can't score.
export const ToneFitResultSchema = z.object({
  tone_fit: z.number().min(0).max(1),
  reason: z.string(),
});
export type ToneFitResult = z.infer<typeof ToneFitResultSchema>;

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
  // D31: non-null only on a follow-up case that succeeded — how well the copy reads in the
  // inherited brand voice.
  tone_fit_score: z.number().min(0).max(1).nullable(),
  tone_fit_reason: z.string().nullable(),
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
  // D31: null on a fixture with no follow-up cases, which is every run before they existed.
  mean_tone_fit: z.number().nullable(),
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
  // Paired per fixture case (D18) using each case's *mean* latency across its repeats, not a
  // literal p50 — true percentiles live on EvalAggregate.latency_ms_p50/p95 for the whole run.
  latency_ms: MetricDeltaSchema,
  // D31: nullable, unlike every dimension above, because it needs follow-up cases present *and
  // scored* on both sides. compareMetric throws on empty paired input by design (it would
  // rather fail than compare misaligned cases), so a run compared against any pre-D31 baseline
  // records null here instead of a fabricated zero-effect delta.
  tone_fit: MetricDeltaSchema.nullable(),
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
  // Live progress for a run still in flight (aggregate is null until it finishes) — a count of
  // eval_results rows recorded so far, so the UI has something to show besides a static badge
  // for however long the run takes.
  completed_case_repeats: z.number().int(),
  aggregate: EvalAggregateSchema.nullable(),
  comparison: EvalComparisonSchema.nullable(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummarySchema>;

export const EvalSummaryResponseSchema = z.object({
  runs: z.array(EvalRunSummarySchema),
});
export type EvalSummaryResponse = z.infer<typeof EvalSummaryResponseSchema>;
