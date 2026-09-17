import type { Pool } from "pg";
import type { StepName } from "@/lib/contracts/stepName";
import type { EvalAggregate, EvalComparison, EvalResultRow, EvalRunSummary } from "@/lib/contracts/eval";

// TRD.md §4/§9 (Stage 2). Mirrors lib/adapters/postgres/generationStore.ts's conventions
// (explicit JSON.stringify for jsonb — pg serializes a JS array as a Postgres array literal,
// not JSON, so binding an object/array directly would be silently wrong).

export interface NewEvalRun {
  label: string;
  gitSha: string;
  target: string;
  fixtureVersion: string;
  promptVersions: Partial<Record<StepName, string>>;
  models: Partial<Record<StepName, string>> & { judge?: string };
  repeats: number;
}

// `POST /api/generate`'s `X-Eval-Run-Id` must reference a row created here first (TRD.md §8) —
// the CLI always calls this before its first case.
export async function createEvalRun(pool: Pool, run: NewEvalRun): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into eval_runs (label, git_sha, target, fixture_version, prompt_versions, models, repeats)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     returning id`,
    [run.label, run.gitSha, run.target, run.fixtureVersion, JSON.stringify(run.promptVersions), JSON.stringify(run.models), run.repeats],
  );
  return rows[0].id;
}

export async function evalRunExists(pool: Pool, id: string): Promise<boolean> {
  const { rows } = await pool.query("select 1 from eval_runs where id = $1", [id]);
  return rows.length > 0;
}

// `--resume` (TRD.md §9) calls this before spending quota on a case × repeat, so a prior
// partial run never re-does work that already completed.
export async function hasEvalResult(pool: Pool, evalRunId: string, caseId: string, repeat: number): Promise<boolean> {
  const { rows } = await pool.query("select 1 from eval_results where eval_run_id = $1 and case_id = $2 and repeat = $3", [evalRunId, caseId, repeat]);
  return rows.length > 0;
}

export async function insertEvalResult(pool: Pool, row: EvalResultRow): Promise<void> {
  await pool.query(
    `insert into eval_results (
       eval_run_id, case_id, repeat, run_id, expected_outcome, actual_outcome, outcome_match,
       first_attempt_pass, quality_retries, throttled, latency_ms, first_event_ms,
       input_tokens, output_tokens, thinking_tokens,
       relevance_score, distinctiveness_score, name_uniqueness, judge_reason
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     on conflict (eval_run_id, case_id, repeat) do nothing`,
    [
      row.eval_run_id,
      row.case_id,
      row.repeat,
      row.run_id,
      row.expected_outcome,
      row.actual_outcome,
      row.outcome_match,
      row.first_attempt_pass,
      row.quality_retries,
      row.throttled,
      row.latency_ms,
      row.first_event_ms,
      row.input_tokens,
      row.output_tokens,
      row.thinking_tokens,
      row.relevance_score,
      row.distinctiveness_score,
      row.name_uniqueness,
      row.judge_reason,
    ],
  );
}

export async function listEvalResults(pool: Pool, evalRunId: string): Promise<EvalResultRow[]> {
  const { rows } = await pool.query(
    `select eval_run_id, case_id, repeat, run_id, expected_outcome, actual_outcome, outcome_match,
            first_attempt_pass, quality_retries, throttled, latency_ms, first_event_ms,
            input_tokens, output_tokens, thinking_tokens,
            relevance_score::float8, distinctiveness_score::float8, name_uniqueness::float8, judge_reason
     from eval_results where eval_run_id = $1 order by case_id, repeat`,
    [evalRunId],
  );
  return rows;
}

export async function finishEvalRun(pool: Pool, id: string, aggregate: EvalAggregate): Promise<void> {
  await pool.query(`update eval_runs set finished_at = now(), aggregate = $2::jsonb where id = $1`, [id, JSON.stringify(aggregate)]);
}

export async function setEvalRunComparison(pool: Pool, id: string, comparison: EvalComparison): Promise<void> {
  await pool.query(`update eval_runs set comparison = $2::jsonb where id = $1`, [id, JSON.stringify(comparison)]);
}

export async function setBaseline(pool: Pool, id: string): Promise<void> {
  await pool.query(`update eval_runs set is_baseline = true where id = $1`, [id]);
}

interface EvalRunRow {
  id: string;
  label: string;
  git_sha: string;
  target: string;
  fixture_version: string;
  prompt_versions: Partial<Record<StepName, string>>;
  models: Partial<Record<StepName, string>>;
  repeats: number;
  is_baseline: boolean;
  aggregate: EvalAggregate | null;
  comparison: EvalComparison | null;
  created_at: Date;
  finished_at: Date | null;
}

const EVAL_RUN_COLUMNS = `id, label, git_sha, target, fixture_version, prompt_versions, models, repeats, is_baseline, aggregate, comparison, created_at, finished_at`;

export async function getEvalRun(pool: Pool, id: string): Promise<EvalRunRow | null> {
  const { rows } = await pool.query<EvalRunRow>(`select ${EVAL_RUN_COLUMNS} from eval_runs where id = $1`, [id]);
  return rows[0] ?? null;
}

// The most recently created row still flagged `is_baseline` — a label may be promoted to
// baseline more than once over time (TRD.md §4), so this is "latest", not "only".
export async function getLatestBaseline(pool: Pool): Promise<EvalRunRow | null> {
  const { rows } = await pool.query<EvalRunRow>(`select ${EVAL_RUN_COLUMNS} from eval_runs where is_baseline order by created_at desc limit 1`);
  return rows[0] ?? null;
}

// GET /api/eval/summary (TRD.md §8) — never eval_results detail.
export async function listEvalRunSummaries(pool: Pool, params: { label?: string; limit: number }): Promise<EvalRunSummary[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.label) {
    values.push(params.label);
    conditions.push(`label = $${values.length}`);
  }
  values.push(params.limit);

  const { rows } = await pool.query<EvalRunRow>(
    `select ${EVAL_RUN_COLUMNS} from eval_runs
     ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
     order by created_at desc
     limit $${values.length}`,
    values,
  );

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    git_sha: row.git_sha,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at?.toISOString() ?? null,
    is_baseline: row.is_baseline,
    repeats: row.repeats,
    aggregate: row.aggregate,
    comparison: row.comparison,
  }));
}
