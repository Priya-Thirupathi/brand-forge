import type { Pool } from "pg";
import type { StepName } from "@/lib/contracts/stepName";
import type { GenerateResult } from "@/lib/contracts/generate";
import type { FeasibilityOptionFacts } from "@/lib/domain/types";
import { firstRunCash } from "@/lib/domain/feasibility";

export interface ReplayStep {
  step: StepName;
  attempt: 1 | 2;
  passed: boolean;
  latencyMs: number;
}

export interface ReplayableRun {
  runId: string;
  steps: ReplayStep[];
  result: GenerateResult;
}

interface RunProductBrandRow {
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

interface RunStepRow {
  step: StepName;
  attempt: 1 | 2;
  model: string;
  prompt_version: string;
  latency_ms: number;
  violations: unknown[];
  error: string | null;
}

// Stage 5, item 1 (PRD.md "Features by Stage"): when the daily quota is exhausted, a visitor
// can watch a stored run stream with its original timings instead of a live one. Picks the
// most recent succeeded, non-hidden, user-sourced run — no curation flag, no new migration: a
// bad pick is fixed the same way a bad gallery entry already is (the existing `hidden` flag),
// and the picker just moves to the next one.
export async function findReplayableRun(pool: Pool): Promise<ReplayableRun | null> {
  const { rows } = await pool.query<RunProductBrandRow>(
    `select r.id as run_id, r.name_candidates, r.quality_retries, r.transport_retries,
            r.input_tokens, r.output_tokens, r.thinking_tokens, r.latency_ms,
            p.id as product_id, p.tagline, p.description, p.packaging, p.feasibility_snapshot,
            b.id as brand_id, b.name as brand_name, b.tone_notes
     from runs r
     join products p on p.run_id = r.id
     join brands b on b.id = p.brand_id
     where r.status = 'succeeded' and r.source = 'user' and p.hidden = false and b.hidden = false
     order by r.created_at desc
     limit 1`,
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: stepRows } = await pool.query<RunStepRow>(
    `select step, attempt, model, prompt_version, latency_ms, violations, error
     from run_steps
     where run_id = $1
     order by created_at asc`,
    [row.run_id],
  );
  if (stepRows.length === 0) return null;

  const steps: ReplayStep[] = stepRows.map((stepRow) => ({
    step: stepRow.step,
    attempt: stepRow.attempt,
    passed: stepRow.violations.length === 0 && stepRow.error === null,
    latencyMs: stepRow.latency_ms,
  }));

  const models: Partial<Record<StepName, string>> = {};
  const promptVersions: Partial<Record<StepName, string>> = {};
  for (const stepRow of stepRows) {
    // Later attempts overwrite earlier ones — the final attempt's model/prompt version is
    // what the client shows for a step, same as GET /api/runs (lib/adapters/postgres/runs.ts).
    models[stepRow.step] = stepRow.model;
    promptVersions[stepRow.step] = stepRow.prompt_version;
  }

  const cash = firstRunCash(row.feasibility_snapshot);

  const result: GenerateResult = {
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

  return { runId: row.run_id, steps, result };
}
