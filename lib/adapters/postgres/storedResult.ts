import type { StepName } from "@/lib/contracts/stepName";
import type { GenerateResult } from "@/lib/contracts/generate";
import type { FeasibilityOptionFacts } from "@/lib/domain/types";
import { firstRunCash } from "@/lib/domain/feasibility";

// Rebuilding a stored succeeded run into the exact GenerateResult shape the API returns. Two
// features need it and must agree: D28's recorded-run replay and D34's exact-match cache. The
// SQL differs (each picks a different run), but the mapping is the delicate part — candidate
// filtering, first-run cash, per-step model/prompt resolution — so that is what is shared.

export const STORED_RESULT_COLUMNS = `r.id as run_id, r.name_candidates, r.quality_retries, r.transport_retries,
            r.input_tokens, r.output_tokens, r.thinking_tokens, r.latency_ms,
            p.id as product_id, p.tagline, p.description, p.packaging, p.feasibility_snapshot,
            b.id as brand_id, b.name as brand_name, b.tone_notes`;

export interface RunProductBrandRow {
  run_id: string;
  name_candidates: { name: string; rationale: string; passed: boolean }[] | null;
  quality_retries: number;
  transport_retries: number;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  latency_ms: number | null;
  product_id: string;
  tagline: string;
  description: string;
  packaging: { headline: string; body: string; callouts: string[] };
  feasibility_snapshot: FeasibilityOptionFacts;
  brand_id: string;
  brand_name: string;
  tone_notes: { voice: string[]; audience: string; personality: string; avoid: string[] };
}

export interface RunStepRow {
  step: StepName;
  attempt: 1 | 2;
  model: string;
  prompt_version: string;
  latency_ms: number;
  violations: unknown[];
  error: string | null;
}

// Later attempts overwrite earlier ones — the final attempt's model/prompt version is what the
// client shows for a step, same as GET /api/runs (lib/adapters/postgres/runs.ts).
export function stepMetaOf(stepRows: readonly RunStepRow[]): {
  models: Partial<Record<StepName, string>>;
  promptVersions: Partial<Record<StepName, string>>;
} {
  const models: Partial<Record<StepName, string>> = {};
  const promptVersions: Partial<Record<StepName, string>> = {};
  for (const stepRow of stepRows) {
    models[stepRow.step] = stepRow.model;
    promptVersions[stepRow.step] = stepRow.prompt_version;
  }
  return { models, promptVersions };
}

export function buildStoredResult(row: RunProductBrandRow, stepRows: readonly RunStepRow[]): GenerateResult {
  const cash = firstRunCash(row.feasibility_snapshot);
  const { models, promptVersions } = stepMetaOf(stepRows);

  return {
    run_id: row.run_id,
    status: "succeeded",
    feasibility: {
      material: row.feasibility_snapshot.material,
      cost_low: row.feasibility_snapshot.costLow,
      cost_high: row.feasibility_snapshot.costHigh,
      currency: row.feasibility_snapshot.currency,
      moq: row.feasibility_snapshot.moq,
      lead_time_days_low: row.feasibility_snapshot.leadTimeDaysLow,
      lead_time_days_high: row.feasibility_snapshot.leadTimeDaysHigh,
      assumptions: row.feasibility_snapshot.assumptions,
      first_run_cost_low: cash.low,
      first_run_cost_high: cash.high,
    },
    brand: { id: row.brand_id, name: row.brand_name, tone_notes: row.tone_notes },
    product: { id: row.product_id, tagline: row.tagline, description: row.description, packaging: row.packaging },
    // Only passing candidates are shown to the client (TRD.md §5 "Name selection") — same rule
    // lib/domain/result.ts's buildSucceededOutcome applies to a live run.
    name_candidates: (row.name_candidates ?? [])
      .filter((candidate) => candidate.passed)
      .map((candidate) => ({ name: candidate.name, selected: candidate.name === row.brand_name })),
    guardrails: { quality_retries: row.quality_retries },
    meta: {
      models,
      prompt_versions: promptVersions,
      latency_ms: row.latency_ms ?? 0,
      transport_retries: row.transport_retries,
      tokens: { input: row.input_tokens, output: row.output_tokens, thinking: row.thinking_tokens },
    },
  };
}
