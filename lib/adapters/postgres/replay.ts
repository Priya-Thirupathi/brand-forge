import type { Pool } from "pg";
import type { StepName } from "@/lib/contracts/stepName";
import type { GenerateResult } from "@/lib/contracts/generate";
import {
  STORED_RESULT_COLUMNS,
  buildStoredResult,
  type RunProductBrandRow,
  type RunStepRow,
} from "./storedResult";

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

// Stage 5, item 1 (PRD.md "Features by Stage"): when the daily quota is exhausted, a visitor
// can watch a stored run stream with its original timings instead of a live one. Picks the
// most recent succeeded, non-hidden, user-sourced run — no curation flag, no new migration: a
// bad pick is fixed the same way a bad gallery entry already is (the existing `hidden` flag),
// and the picker just moves to the next one.
export async function findReplayableRun(pool: Pool): Promise<ReplayableRun | null> {
  const { rows } = await pool.query<RunProductBrandRow>(
    `select ${STORED_RESULT_COLUMNS}
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

  const result = buildStoredResult(row, stepRows);

  return { runId: row.run_id, steps, result };
}
